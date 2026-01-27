const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
const ITEM_REGISTRY = require('./public/items.js');
const { loadMaps } = require('./server/MapLoader.js');
const GameRoom = require('./server/GameRoom.js');
const ItemLogic = require('./server/ItemLogic.js');

// --- CONSTANTES ---
const MAPS = loadMaps();
const MAX_PLAYERS = 8;

let rooms = {}; 

function getPublicRooms() {
    return Object.values(rooms)
        .filter(r => r.config.isPublic && r.state === 'LOBBY')
        .map(r => ({
            code: r.code,
            count: Object.keys(r.players).length,
            max: MAX_PLAYERS,
            hasPass: r.config.password !== ""
        }));
}

io.on('connection', (socket) => {


    socket.on('requestMapList', () => {

        const list = Object.keys(MAPS).map(id => ({ 
            id: id, 
            name: MAPS[id].name,
            data: MAPS[id].data // <-- Ajout vital pour la preview
        }));
        socket.emit('mapListUpdate', list);
    });

    // LOBBY
    socket.on('requestRoomList', () => socket.emit('roomListUpdate', getPublicRooms()));

    socket.on('createRoom', (config) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        // On récupère l'ID de la map choisi dans la config, ou 'level1' par défaut
        const mapId = config.mapId || 'classique';
        
        const room = new GameRoom(code, socket.id, config, mapId, io, MAPS);
        rooms[code] = room;
        room.addPlayer(socket.id, config.name, config.color);
        socket.join(code);
        socket.emit('roomJoined', { 
            code, 
            isHost: true, 
            players: room.players,
            // AJOUT : On envoie les données de la map pour l'affichage
            mapData: MAPS[mapId].data,
            mapName: MAPS[mapId].name
        });
        io.emit('roomListUpdate', getPublicRooms());
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.code];
        if (!room) return socket.emit('errorMsg', "Introuvable");
        if (room.config.password && room.config.password !== data.password) return socket.emit('errorMsg', "Mauvais mot de passe");
        
        room.addPlayer(socket.id, data.name, data.color);
        socket.join(data.code);
        socket.emit('roomJoined', { 
            code: data.code, 
            isHost: false, 
            players: room.players,
            // AJOUT
            mapData: room.MAPS[room.mapId].data,
            mapName: room.MAPS[room.mapId].name
        });
        io.to(data.code).emit('updatePlayers', room.players);
        io.emit('roomListUpdate', getPublicRooms());
    });

    socket.on('startGame', (code) => {
        const room = rooms[code];
        if (room && room.players[room.sockets[socket.id]].isHost) {
            // NOTE: On délègue tout à room.startGame() qui gère le délai maintenant
            room.startGame(); 
        }
    });

    // GAMEPLAY
    socket.on('joinGamePhase', (data) => {
        const room = rooms[data.code];
        if (room) {
            let found = false;
            for(let pId in room.players) {
                if(room.players[pId].name === data.name) {
                    room.sockets[socket.id] = pId;
                    socket.join(data.code);
                    found = true;
                    
                    const player = room.players[pId];
                    player.online = true; 
                    if (room.disconnectedPlayers && room.disconnectedPlayers[pId]) {
                        delete room.disconnectedPlayers[pId];
                    }

                    // --- AJOUT : GESTION DE LA MORT SUR RECONNEXION ---
                    // Si on est en phase de RUN et en mode PERMA, le joueur doit mourir
                    if (room.state === 'RUN' && room.config.gameMode === 'perma') {
                        // S'il n'avait pas fini, il meurt
                        if (!player.hasFinished) {
                            player.isDead = true; 
                            console.log(`[${room.code}] ${player.name} éliminé suite à reconnexion (Mode Perma).`);
                        }
                    }
                    // --------------------------------------------------
                    
                    console.log(`[${room.code}] ${player.name} est RECONNECTÉ.`);

                    socket.emit('gameState', { 
                        state: room.state, 
                        map: room.mapData, 
                        players: room.players,
                        options: room.draftOptions,
                        roomConfig: { mode: room.config.gameMode }
                    });
                    
                    socket.emit('timerUpdate', room.timerValue);
                    io.to(room.code).emit('updatePlayers', room.players);
                    
                    // Vérifications de blocage
                    if (room.state === 'DRAFT') room.checkAllSelected();
                    if (room.state === 'PLACEMENT') room.checkAllPlaced();
                    if (room.state === 'RUN') room.checkEndRoundCondition(); // <-- Vérif utile si sa mort termine la manche

                    break;
                }
            }
            if(!found) socket.emit('errorMsg', "Joueur non reconnu.");
        }
    });

    socket.on('selectItem', (itemId) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        
        if (room && room.state === 'DRAFT') {
            const pId = room.sockets[socket.id];
            
            // On cherche l'item dans le registre
            const item = ITEM_REGISTRY[itemId];
            
            if(item) {
                // On assigne l'item au joueur
                room.players[pId].selectedItem = item;
                
                // --- AJOUTER CECI ---
                // On vérifie si c'était le dernier joueur à choisir
                room.checkAllSelected();
            }
        }
    });

    socket.on('tryPlaceItem', (pos) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if(room) room.placeItem(room.sockets[socket.id], pos.x, pos.y, pos.rotation);
    });

    socket.on('playerMove', (pos) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if(room && room.state === 'RUN') {
            socket.to(room.code).emit('remoteMove', { id: room.sockets[socket.id], x: pos.x, y: pos.y, anim: pos.anim });
        }
    });

    socket.on('reachedGoal', () => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if(room) room.playerFinished(room.sockets[socket.id]);
    });

    socket.on('disconnect', () => {
        // Trouver la room du joueur
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        
        if (room) {
            if (room.state === 'LOBBY') {
                // --- LOGIQUE LOBBY (inchangée : suppression totale) ---
                const pId = room.sockets[socket.id];
                delete room.sockets[socket.id];
                delete room.players[pId];
                
                if (Object.keys(room.players).length === 0) {
                    delete rooms[room.code];
                } else {
                    // Gestion changement d'hôte si besoin
                    const firstPId = Object.keys(room.players)[0];
                    if(firstPId && !Object.values(room.players).some(p => p.isHost)) {
                        room.players[firstPId].isHost = true;
                    }
                    io.to(room.code).emit('updatePlayers', room.players);
                }
            } else {
                // --- LOGIQUE EN JEU (Nouvelle méthode) ---
                // On délègue tout à la Room pour qu'elle recalcule les états
                room.handleDisconnect(socket.id);
                
                // On prévient les autres que X est déconnecté (visuellement)
                io.to(room.code).emit('updatePlayers', room.players);
            }
            io.emit('roomListUpdate', getPublicRooms());
        }
    });

    socket.on('reportDeath', (posData) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (room) {
            const pId = room.sockets[socket.id];
            // On passe posData à la fonction de la room
            room.handlePlayerDeath(pId, posData);
        }
    });

    socket.on('playerRespawn', () => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (room && room.state === 'RUN') {
            const pId = room.sockets[socket.id];
            // On remet le joueur en vie côté serveur
            if (room.players[pId]) {
                room.players[pId].isDead = false;
                if (room.players[pId].originalColor) {
                    room.players[pId].color = room.players[pId].originalColor;
                }
            }
        }
    });

    socket.on('voteSkip', () => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (room) {
            const pId = room.sockets[socket.id];
            room.handleSkipVote(pId); // On délègue à GameRoom
        }
    });

    socket.on('triggerBomb', (itemId) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (!room || room.state !== 'RUN') return;

        const itemInstance = room.mapData.find(i => i.id === itemId);
        if (!itemInstance) return;

        // On regarde si on a une logique définie pour ce TYPE d'item (ex: Type 7)
        if (ItemLogic[itemInstance.type]) {
            // On exécute la logique en lui passant la Room entière et l'item
            ItemLogic[itemInstance.type](room, itemInstance);
        }
    });

    socket.on('triggerNuke', (itemId) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (!room || room.state !== 'RUN') return;

        const itemInstance = room.mapData.find(i => i.id === itemId);
        if (!itemInstance) return;

        // On appelle la logique ID 10 (définie à l'étape suivante)
        if (ItemLogic[10]) {
            ItemLogic[10](room, itemInstance);
        }
    });

});



const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('>> NetParty Server v2 running'));