const ITEM_REGISTRY = require('../../../public/items.js'); 
const ItemLogic = require('./ItemLogic.js'); 
const GRID_SIZE = 32;

class BangersGame {
    constructor(room, config) {
        this.room = room;       
        this.io = room.io;      
        this.code = room.code;      
        this.config = config;
        this.type = 'bangers';
        this.MAPS = config.allMaps; 

        // Paramètres
        this.maxScore = parseInt(this.config.maxScore) || 20;
        this.runTime = parseInt(this.config.runTime) || 45;
        this.mapId = this.config.mapId || 'classique';
        
        // State
        this.gamePlayers = {}; 
        this.state = 'LOADING'; 
        this.mapData = [];
        this.round = 0;
        this.timerValue = 0;
        this.timerInterval = null;
        this.skipVotes = new Set();
        this.draftOptions = {};
    }

    init() {
        console.log(`[Bangers] Init room ${this.code}`);
        // On transforme les joueurs "Hub" en joueurs "Bangers"
        Object.values(this.room.players).forEach(p => {
            this.addGamePlayer(p.id, p.name, p.color);
        });
        
        this.startGameLogic(); 
    }

    addGamePlayer(id, name, color) {

        let safeColor = 0xFFFFFF; // Blanc par défaut
        
        if (color) {
            if (typeof color === 'number') {
                safeColor = color;
            } else if (typeof color === 'string' && color.startsWith('#')) {
                // Convertit "#ff0000" en le nombre 0xff0000
                safeColor = parseInt(color.replace('#', ''), 16);
            }
        }

        this.gamePlayers[id] = {
            id: id,
            name: name,
            color: safeColor,
            originalColor: safeColor,           
            score: 0,
            selectedItem: null,
            hasFinished: false,
            hasPlaced: false,
            online: true,
            isDead: false
        };
    }

    // --- LE ROUTEUR D'ÉVÉNEMENTS ---
    handleClientEvent(event, socketId, data) {
        const playerId = this.room.sockets[socketId];
        if (!playerId) return;

        switch(event) {
            case 'joinGamePhase':
                this.handlePlayerJoin(socketId, playerId); // <-- Corrigé: on passe playerId
                break;
            case 'selectItem':
                this.handleSelectItem(playerId, data);
                break;
            case 'tryPlaceItem':
                this.placeItem(playerId, data.x, data.y, data.rotation);
                break;
            case 'playerMove':
                if(this.state === 'RUN') {
                    this.io.to(this.code).except(socketId).emit('remoteMove', { id: playerId, ...data });                
                }
                break;
            case 'reachedGoal':
                this.playerFinished(playerId);
                break;
            case 'reportDeath':
                this.handlePlayerDeath(playerId, data);
                break;
            case 'playerRespawn':
                this.handlePlayerRespawn(playerId);
                break;
            case 'voteSkip':
                this.handleSkipVote(playerId);
                break;
            case 'triggerBomb':
            case 'triggerNuke':
                this.handleTriggerItem(playerId, data, event === 'triggerNuke' ? 10 : null);
                break;
        }
    }

    // Appelé par Room.js quand un joueur quitte
    onPlayerDisconnect(socketId) {
        const playerId = this.room.sockets[socketId];
        if (!playerId || !this.gamePlayers[playerId]) return;

        const player = this.gamePlayers[playerId];
        player.online = false; 
        
        console.log(`[${this.code}] ${player.name} passé en mode HORS LIGNE.`);

        this.broadcast('updatePlayers', this.gamePlayers);
        // IMPORTANT : On vérifie si le jeu peut continuer sans lui !
        if (this.state === 'DRAFT') this.checkAllSelected();
        if (this.state === 'PLACEMENT') this.checkAllPlaced();
        if (this.state === 'RUN') {
            const onlinePlayers = Object.values(this.gamePlayers).filter(p => p.online);
            
            // Si plus personne n'est là
            if (onlinePlayers.length === 0) {
                 this.stopTimer(); // Pause
                 return;
            }

            // Gestion du Skip Vote si un joueur part
            if (this.skipVotes.size >= onlinePlayers.length && onlinePlayers.length > 0) {
                 const anyoneFinished = Object.values(this.gamePlayers).some(p => p.hasFinished);
                 if (!anyoneFinished) {
                     this.startScorePhase();
                     return;
                 }
            } else {
                this.broadcast('voteUpdate', { 
                    current: this.skipVotes.size, 
                    required: onlinePlayers.length 
                });
            }
            
            this.checkEndRoundCondition();
        }
    }

    handlePlayerJoin(socketId, playerId) {
        // 1. Récupérer l'objet Socket réel via son ID
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) return; // Sécurité si le socket n'existe plus

        // 2. Vérifier si le joueur existe dans la partie
        // (playerId est sous la forme "Nom_Code", c'est la clé dans gamePlayers)
        const p = this.gamePlayers[playerId];

        if (p) {
            console.log(`[${this.code}] ${p.name} rejoint la phase de jeu (Reconnexion).`);

            // 3. Mise à jour de la liaison Socket <-> Player dans la Room parente
            this.room.sockets[socketId] = playerId;
            
            // 4. Faire rejoindre le canal Socket.io pour recevoir les broadcasts
            socket.join(this.code); 

            // 5. Mettre à jour le statut
            p.online = true; 

            // Logique Spéciale : Si mode PERMA et la partie est en cours, il meurt à la reco s'il n'a pas fini
            if (this.state === 'RUN' && this.config.gameMode === 'perma' && !p.hasFinished) {
                p.isDead = true;
            }

            // 6. Envoyer l'état complet AU JOUEUR SEUL (via son socket objet)
            socket.emit('gameState', {
                state: this.state,
                map: this.mapData,
                players: this.gamePlayers, // Contient les couleurs
                round: this.round,
                options: this.draftOptions,
                roomConfig: { mode: this.config.gameMode }
            });

            // 7. IMPORTANT : Prévenir TOUS LES AUTRES que le joueur est là (pour dégriser le nom)
            this.broadcast('updatePlayers', this.gamePlayers);
            
            // 8. Sync du timer
            socket.emit('timerUpdate', this.timerValue);

        } else {
            // Si le joueur n'est pas trouvé
            socket.emit('errorMsg', "Tu ne fais pas partie de cette partie !");
        }
    }

    // --- LOGIQUE DU JEU ---

    startGameLogic() { // Renommé pour matcher init()
        this.state = 'LOADING';
        this.round = 0;
        
        // Chargement Map
        const selectedMap = this.MAPS[this.mapId];

        if (selectedMap) {
            this.mapData = selectedMap.data.map(item => {
            const itemDef = ITEM_REGISTRY[item.type];
            return {
                ...item,
                id: Date.now() + Math.random(),
                owner: 'server',
                isDestructible: itemDef ? (itemDef.isDestructible !== false) : true
            };
        });

        } else {
            console.error("Carte introuvable, chargement par défaut");
            this.mapData = [];   
        }

        // Redirection
        this.broadcast('redirectGame', { url: `/game.html?room=${this.code}` });
        console.log(`[${this.code}] Chargement de la partie...`);

        setTimeout(() => {
            this.startDraftPhase();
        }, 4000);
    }

    startDraftPhase() {
        this.state = 'DRAFT';
        this.round++;
        console.log(`[${this.code}] Phase DRAFT`);     

        const globalAvailableIds = Object.keys(ITEM_REGISTRY).filter(id => {
            const isSystem = ITEM_REGISTRY[id].isSystem;
            const isAllowed = this.config.allowedItems ? this.config.allowedItems.includes(parseInt(id)) : true;
            return !isSystem && isAllowed;
        });
        
        // Fallback si aucun item autorisé
        const poolToUse = globalAvailableIds.length > 0 ? globalAvailableIds : Object.keys(ITEM_REGISTRY).filter(id => !ITEM_REGISTRY[id].isSystem);

        for (let pId in this.gamePlayers) {
            this.gamePlayers[pId].selectedItem = null;
            this.gamePlayers[pId].hasFinished = false;
            this.gamePlayers[pId].hasPlaced = false; 
            
            const options = [];
            let playerPool = [...poolToUse];
            
            for(let i=0; i<3; i++) {
                if(playerPool.length === 0) break;
                const randomIndex = Math.floor(Math.random() * playerPool.length);
                const selectedId = playerPool[randomIndex];
                options.push(ITEM_REGISTRY[selectedId]);
                playerPool.splice(randomIndex, 1);
            }
            this.draftOptions[pId] = options;
        }

        this.broadcast('gameState', { 
            state: 'DRAFT', 
            round: this.round, 
            options: this.draftOptions,
            roomConfig: { mode: this.config.gameMode }
        });
        this.startTimer(10, () => this.startPlacementPhase());
    }

    handleSelectItem(playerId, itemId) {
        if (this.state === 'DRAFT') {
            const item = ITEM_REGISTRY[itemId];
            if(item && this.gamePlayers[playerId]) {
                this.gamePlayers[playerId].selectedItem = item;
                this.checkAllSelected();
            }
        }
    }

    checkAllSelected() {
        const onlinePlayers = Object.values(this.gamePlayers).filter(p => p.online);
        const allSelected = onlinePlayers.every(p => p.selectedItem !== null);
        if (allSelected && onlinePlayers.length > 0) {
            this.startPlacementPhase();
        }
    }

    startPlacementPhase() {
        this.state = 'PLACEMENT';
        for (let pId in this.gamePlayers) {
            if (!this.gamePlayers[pId].selectedItem) {
                this.gamePlayers[pId].selectedItem = ITEM_REGISTRY[1]; // Item par défaut
            }
        }
        
        this.broadcast('gameState', { 
            state: 'PLACEMENT', 
            players: this.gamePlayers, 
            map: this.mapData 
        });
        
        this.startTimer(15, () => this.startRunPhase());
    }

    placeItem(playerId, x, y, rotation = 0) {
        if (this.state !== 'PLACEMENT') return;
        const player = this.gamePlayers[playerId];
        if (!player || !player.selectedItem || player.hasPlaced) return;

        const gridX = Math.floor(x / GRID_SIZE) * GRID_SIZE;
        const gridY = Math.floor(y / GRID_SIZE) * GRID_SIZE;

        const exists = this.mapData.find(i => i.x === gridX && i.y === gridY);
        if (exists) return;

        const item = {
            id: Date.now(),
            type: player.selectedItem.id,
            x: gridX,
            y: gridY,
            rotation: rotation,
            owner: playerId
        };
        this.mapData.push(item);
        player.hasPlaced = true;
        this.broadcast('itemPlaced', item);
        this.checkAllPlaced();
    }

    checkAllPlaced() {
        const onlinePlayers = Object.values(this.gamePlayers).filter(p => p.online);
        const allDone = onlinePlayers.every(p => p.hasPlaced);
        if (allDone && onlinePlayers.length > 0) {
            this.startRunPhase();
        }
    }

    startRunPhase() {
        this.state = 'RUN';
        this.stopTimer();
        this.skipVotes.clear();
        
        for(let pId in this.gamePlayers) {
            this.gamePlayers[pId].isDead = false; 
        }

        this.broadcast('gameState', { state: 'RUN', map: this.mapData });
        this.startTimer(this.config.runTime, () => this.startScorePhase());
    }

    handlePlayerRespawn(playerId) {
        if (this.state === 'RUN' && this.gamePlayers[playerId]) {
            this.gamePlayers[playerId].isDead = false;
        }
    }

    handleTriggerItem(playerId, itemId, forceType) {
        if (this.state !== 'RUN') return;
        const itemInstance = this.mapData.find(i => i.id === itemId);
        if (!itemInstance) return;

        const type = forceType || itemInstance.type;
        if (ItemLogic[type]) {
            ItemLogic[type](this, itemInstance);
        }
    }

    handlePlayerDeath(playerId, posData) {
        if (this.state !== 'RUN') return;
        const p = this.gamePlayers[playerId];
        if (p && !p.isDead) {
            p.isDead = true;
            if (posData && posData.x !== undefined) {
                this.broadcast('playerDeathEffect', {
                    id: playerId,
                    x: posData.x,
                    y: posData.y,
                    color: p.color
                });
            }
            this.checkEndRoundCondition();
        }
    }

    playerFinished(playerId) {
        if (this.state !== 'RUN') return;
        const p = this.gamePlayers[playerId];
        
        if (p && !p.hasFinished) {
            p.hasFinished = true;
            this.broadcast('voteUpdate', { current: 0, required: 0 }); 
            this.skipVotes.clear(); 

            const finishers = Object.values(this.gamePlayers).filter(pl => pl.hasFinished).length;
            const points = finishers === 1 ? 3 : 1;
            p.score += points;
            
            this.broadcast('playerGoal', { id: playerId, points });
            this.checkEndRoundCondition();
        }
    }

    checkEndRoundCondition() {
        if (this.state !== 'RUN') return;

        const onlinePlayers = Object.values(this.gamePlayers).filter(p => p.online);
        if (onlinePlayers.length === 0) {
            this.startScorePhase(); 
            return;
        }

        if (this.config.gameMode === 'perma') {
            const activeCount = onlinePlayers.filter(p => !p.isDead && !p.hasFinished).length;
            if (activeCount === 0) this.startScorePhase();
        } else {
            const finishedCount = onlinePlayers.filter(p => p.hasFinished).length;
            if (finishedCount === onlinePlayers.length) this.startScorePhase();
        }
    }

    handleSkipVote(playerId) {
        if (this.state !== 'RUN') return;
        const anyoneFinished = Object.values(this.gamePlayers).some(p => p.hasFinished);
        if (anyoneFinished) return; 

        this.skipVotes.add(playerId);

        const onlinePlayers = Object.values(this.gamePlayers).filter(p => p.online);
        const requiredVotes = onlinePlayers.length;
        const currentVotes = this.skipVotes.size;

        this.broadcast('voteUpdate', { current: currentVotes, required: requiredVotes });

        if (currentVotes >= requiredVotes && requiredVotes > 0) {
            this.startScorePhase();
        }
    }

    startScorePhase() {
        this.state = 'SCORE';
        this.stopTimer();

        let winner = null;
        for(let pId in this.gamePlayers) {
            if(this.gamePlayers[pId].score >= this.maxScore) winner = this.gamePlayers[pId];
        }

        this.broadcast('gameState', { state: 'SCORE', players: this.gamePlayers, winner: winner });

        if (!winner) {
            this.startTimer(5, () => this.startDraftPhase());
        } else {
            this.startTimer(8, () => {
                this.state = 'LOBBY';
                this.mapData = [];
                for(let p in this.gamePlayers) this.gamePlayers[p].score = 0;
                this.broadcast('forceRedirect', '/');
            });
        }
    }

    // --- UTILITAIRES ---
    broadcast(event, data) {
        this.io.to(this.code).emit(event, data);
    }

    startTimer(seconds, onEndCallback) {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerValue = seconds;
        this.broadcast('timerUpdate', this.timerValue);

        this.timerInterval = setInterval(() => {
            this.timerValue--;
            this.broadcast('timerUpdate', this.timerValue);

            if (this.timerValue <= 0) {
                clearInterval(this.timerInterval);
                if (onEndCallback) onEndCallback();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerValue = 0;
        this.broadcast('timerUpdate', 0);
    }
}

module.exports = BangersGame;