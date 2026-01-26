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
        // On envoie juste { id: 'level1', name: 'Plaines Vertes' }
        const list = Object.keys(MAPS).map(id => ({ id: id, name: MAPS[id].name }));
        socket.emit('mapListUpdate', list);
    });

    // LOBBY
    socket.on('requestRoomList', () => socket.emit('roomListUpdate', getPublicRooms()));

    socket.on('createRoom', (config) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        // On récupère l'ID de la map choisi dans la config, ou 'level1' par défaut
        const mapId = config.mapId || 'level1';
        
        const room = new GameRoom(code, socket.id, config, mapId, io, MAPS);
        rooms[code] = room;
        room.addPlayer(socket.id, config.name, config.color);
        socket.join(code);
        socket.emit('roomJoined', { code, isHost: true, players: room.players });
        io.emit('roomListUpdate', getPublicRooms());
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.code];
        if (!room) return socket.emit('errorMsg', "Introuvable");
        if (room.config.password && room.config.password !== data.password) return socket.emit('errorMsg', "Mauvais mot de passe");
        
        room.addPlayer(socket.id, data.name, data.color);
        socket.join(data.code);
        socket.emit('roomJoined', { code: data.code, isHost: false, players: room.players });
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
                    
                    // --- MODIFICATION ICI ---
                    // On envoie systématiquement la map et l'état actuel
                    socket.emit('gameState', { 
                        state: room.state, 
                        map: room.mapData, // Envoie la map dès maintenant !
                        players: room.players,
                        options: room.draftOptions 
                    });
                    
                    socket.emit('timerUpdate', room.timerValue);
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
            // On cherche directement dans le registre avec l'ID reçu
            const item = ITEM_REGISTRY[itemId];
            if(item) room.players[pId].selectedItem = item;
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
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (room) {
            const pId = room.sockets[socket.id];
            const wasHost = room.players[pId] && room.players[pId].isHost;
            delete room.sockets[socket.id];

            if (room.state === 'LOBBY') {
                delete room.players[pId];
                if (Object.keys(room.players).length === 0) delete rooms[room.code];
                else {
                    if (wasHost) {
                        const nextPlayerId = Object.keys(room.players)[0];
                        if(nextPlayerId) room.players[nextPlayerId].isHost = true;
                    }
                    io.to(room.code).emit('updatePlayers', room.players);
                }
                io.emit('roomListUpdate', getPublicRooms());
            } else {
                console.log(`[${room.code}] ${pId} déconnecté temporairement.`);
            }
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

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('>> NetParty Server v2 running'));