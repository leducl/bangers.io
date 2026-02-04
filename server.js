const Room = require('./server/core/Room.js'); 
const BangersGame = require('./server/games/bangers/BangersGame.js');
const LiarsGame = require('./server/games/liars/LiarsGame.js'); 

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Chargement des maps (Attention au chemin qui doit être correct)
const { loadMaps } = require('./server/games/bangers/MapLoader.js');
const MAPS = loadMaps();
const MAX_PLAYERS = 8;

let rooms = {}; 

function getPublicRooms() {
    return Object.values(rooms)
        .filter(r => r.config.isPublic && !r.activeGame)
        .map(r => ({
            code: r.code,
            count: Object.keys(r.players).length,
            max: MAX_PLAYERS,
            hasPass: r.config.password !== ""
        }));
}

// Liste des événements standards (une fois connecté au jeu)
const GAME_EVENTS = [
    'selectItem', 'tryPlaceItem', 'playerMove', 
    'reachedGoal', 'reportDeath', 'playerRespawn', 'voteSkip', 
    'triggerBomb', 'triggerNuke',

    //Liars BAR
    'playCards', 'callLiar', 'passTurn'
];

io.on('connection', (socket) => {
    
    // --- 1. ROUTAGE SPÉCIAL POUR LA RECONNEXION (Le fix est ICI) ---
    socket.on('joinGamePhase', (data) => {
        // data contient { code, name }
        const room = rooms[data.code];
        
        if (room) {
            // ÉTAPE CRUCIALE : On ré-associe ce NOUVEAU socket au joueur existant
            // La méthode addPlayer de Room va mettre à jour this.sockets[socket.id]
            const result = room.addPlayer(socket.id, data.name, null);
            
            socket.join(data.code);
            
            // Maintenant que le lien est fait, on prévient le jeu !
            if (room.activeGame) {
                room.activeGame.handleClientEvent('joinGamePhase', socket.id, data);
            }
        } else {
            socket.emit('errorMsg', "Partie introuvable ou terminée.");
        }
    });

    // --- 2. ROUTAGE GÉNÉRIQUE (Pour les joueurs déjà reconnus) ---
    GAME_EVENTS.forEach(eventName => {
        socket.on(eventName, (data) => {
            // On trouve la room grâce au socket ID (car on l'a enregistré juste avant !)
            const room = Object.values(rooms).find(r => r.sockets[socket.id]);
            if (room && room.activeGame) {
                room.activeGame.handleClientEvent(eventName, socket.id, data);
            }
        });
    });

    // --- 3. GESTION DU HUB ---

    socket.on('hub_launchGame', (data) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);

        if (room && room.isHost(socket.id)) {
            console.log(`Lancement du jeu : ${data.gameId}`);

            // SI C'EST BANGERS
            if (data.gameId === 'bangers') {
                room.startGame(BangersGame, { 
                    ...room.config, 
                    ...data.options, 
                    allMaps: MAPS // Bangers a besoin des maps
                });
            } 
            // SI C'EST LIARS BAR
            else if (data.gameId === 'liars') {
                room.startGame(LiarsGame, { 
                    ...room.config, 
                    ...data.options 
                    // Liars n'a pas besoin de 'allMaps'
                });
            }
        }
    });

    socket.on('disconnect', () => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (room) {
            room.removePlayer(socket.id);
            
            // Si la room est vide ET qu'aucun jeu n'est en cours, on supprime
            // (Si un jeu est en cours, on garde la room un moment pour permettre la reco)
            if (Object.keys(room.players).length === 0 && !room.activeGame) {
                delete rooms[room.code];
            }
            io.emit('roomListUpdate', getPublicRooms());
        }
    });

    socket.on('requestMapList', () => {
        const list = Object.keys(MAPS).map(id => ({ 
            id: id, name: MAPS[id].name 
        }));
        socket.emit('mapListUpdate', list);
    });

    socket.on('requestRoomList', () => socket.emit('roomListUpdate', getPublicRooms()));

    socket.on('createRoom', (config) => {
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        const room = new Room(code, socket.id, io, config); 
        rooms[code] = room;
        
        room.addPlayer(socket.id, config.name, config.color);
        socket.join(code);
        room.config.gameId = 'bangers';
        
        socket.emit('roomJoined', { 
            code, 
            isHost: true, 
            players: room.players,
            config: room.config
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
            config: room.config
        });
        io.to(data.code).emit('updatePlayers', room.players);
        io.emit('roomListUpdate', getPublicRooms());
    });

    // --- GESTION DES PARAMÈTRES DU LOBBY ---
    socket.on('updateLobbySettings', (settings) => {
        const room = Object.values(rooms).find(r => r.sockets[socket.id]);
        if (room && room.isHost(socket.id)) {
            // On sauvegarde la config dans la room
            room.config = { ...room.config, ...settings };

            // Si la map a changé, on récupère ses données pour la prévisualisation
            let previewData = null;
            if (settings.mapId && MAPS[settings.mapId]) {
                previewData = MAPS[settings.mapId].data;
            } else if (room.config.mapId && MAPS[room.config.mapId]) {
                // Si la map n'a pas changé mais qu'on a besoin de renvoyer l'info
                previewData = MAPS[room.config.mapId].data;
            }

            // On diffuse à TOUT LE MONDE dans la salle (Hôte inclus pour confirmation)
            io.to(room.code).emit('lobbySettingsUpdate', {
                config: room.config,
                mapPreview: previewData
            });
        }
    });

    // Quand un joueur rejoint, on lui envoie les settings actuels
    socket.on('requestLobbyInfo', () => {
         const room = Object.values(rooms).find(r => r.sockets[socket.id]);
         if(room) {
             let previewData = (room.config.mapId && MAPS[room.config.mapId]) ? MAPS[room.config.mapId].data : null;
             socket.emit('lobbySettingsUpdate', { config: room.config, mapPreview: previewData });
         }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('>> NetParty Hub Server running'));