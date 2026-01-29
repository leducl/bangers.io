class Room {
    constructor(code, hostId, io, config) {
        this.code = code;
        this.io = io;
        this.hostId = hostId;
        this.config = config || {}; // On stocke la config du lobby (nom, pass, etc.)

        this.players = {}; 
        this.disconnectedPlayers = {}; // <-- AJOUTÉ
        this.sockets = {};             // <-- AJOUTÉ
        
        this.activeGame = null;
    }

    isHost(socketId) {
        return socketId === this.hostId;
    }

    addPlayer(socketId, name, color) {
        const playerId = name + "_" + this.code;
        
        if (this.disconnectedPlayers[playerId]) {
            console.log(`[${this.code}] Restauration de ${name}`);
            this.players[playerId] = this.disconnectedPlayers[playerId];
            this.players[playerId].online = true;
            delete this.disconnectedPlayers[playerId];
        } 
        else if (!this.players[playerId]) {
            this.players[playerId] = {
                id: playerId,
                name: name,
                color: color,
                originalColor: color,
                isHost: socketId === this.hostId,
                online: true,
                // Les propriétés spécifiques au jeu (score, isDead...) 
                // ne doivent PAS être ici, mais dans BangersGame !
            };
        }
        
        this.sockets[socketId] = playerId;
        return { success: true, playerId };
    }

    // Lancer un jeu
    startGame(GameClass, options) {
        // On fusionne la config du lobby avec les options spécifiques
        const gameConfig = { ...this.config, ...options };
        
        this.activeGame = new GameClass(this, gameConfig);
        this.activeGame.init();
        
        // Redirection des clients (Ex: chargement de bangers.html ou mode jeu)
        // this.io.to(this.code).emit('redirectGame', { url: '/game.html?room=' + this.code });
    }

    removePlayer(socketId) {
        const playerId = this.sockets[socketId];
        const wasHost = (socketId === this.hostId);

        // Prévenir le jeu si actif
        if (this.activeGame && typeof this.activeGame.onPlayerDisconnect === 'function') {
            this.activeGame.onPlayerDisconnect(socketId);
        }

        if (playerId && this.players[playerId]) {
            this.players[playerId].online = false;

            if (!this.activeGame) {
                delete this.players[playerId];
                delete this.sockets[socketId];

                // --- MIGRATION DE L'HÔTE ---
                if (wasHost) {
                    const remainingSockets = Object.keys(this.sockets);
                    if (remainingSockets.length > 0) {
                        const newHostSocket = remainingSockets[0];
                        const newHostPlayerId = this.sockets[newHostSocket];
                        
                        this.hostId = newHostSocket;
                        
                        if (this.players[newHostPlayerId]) {
                            this.players[newHostPlayerId].isHost = true;
                            
                            // === NOUVEAU : On prévient le nouvel hôte spécifiquement ===
                            // On lui envoie la config actuelle pour qu'il mette à jour ses inputs
                            this.io.to(newHostSocket).emit('youAreHost', this.config);
                            
                            console.log(`[${this.code}] Nouvel hôte : ${this.players[newHostPlayerId].name}`);
                        }
                    }
                }

                // Mise à jour de la liste visuelle pour tout le monde
                this.io.to(this.code).emit('updatePlayers', this.players);
            }
        }
    }
}


module.exports = Room; // <-- CORRIGÉ (C'était GameRoom)