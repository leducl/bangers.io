// server/GameRoom.js
const ITEM_REGISTRY = require('../public/items.js');
const GRID_SIZE = 32;


class GameRoom {
    constructor(code, hostId, config, mapId, io, allMaps) {
        this.io = io;           // On stocke l'instance Socket.io
        this.MAPS = allMaps;    // On stocke la liste des cartes
        this.code = code;
        this.hostId = hostId;
        this.config = config;

        // On s'assure d'avoir des valeurs par défaut si bug
        this.config.runTime = this.config.runTime || 45;
        this.config.gameMode = this.config.gameMode || 'respawn';
        this.config.allowedItems = this.config.allowedItems || [];

        this.mapId = mapId;
        this.players = {}; 
        this.sockets = {}; 
        this.state = 'LOBBY'; 
        
        this.mapData = [];
        this.round = 0;
        
        this.timerValue = 0;
        this.timerInterval = null;

        this.draftOptions = {};
    }

    addPlayer(socketId, name, color) {
        const playerId = name + "_" + this.code; 
        if (!this.players[playerId]) {
            this.players[playerId] = {
                id: playerId,
                name: name,
                color: color,
                score: 0,
                isHost: socketId === this.hostId,
                selectedItem: null,
                hasFinished: false,
                hasPlaced: false
            };
        }
        this.sockets[socketId] = playerId;
        return { success: true, playerId };
    }

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

    checkAllSelected() {
        // On récupère la liste des joueurs
        const activePlayers = Object.values(this.players);
        
        // On vérifie si TOUS les joueurs ont un 'selectedItem' non null
        const allSelected = activePlayers.every(p => p.selectedItem !== null);

        // Si tout le monde a choisi et qu'il y a des joueurs
        if (allSelected && activePlayers.length > 0) {
            console.log(`[${this.code}] Draft terminé (Tous ont choisi). Lancement Placement.`);
            // On lance la phase suivante immédiatement
            this.startPlacementPhase();
        }
    }

    // --- CORRECTION DU LANCEMENT ---
    startGame() {
        // 1. On passe en état de chargement
        this.state = 'LOADING';
        this.round = 0;
        
        // --- CHARGEMENT DYNAMIQUE DE LA CARTE ---
        const selectedMap = this.MAPS[this.mapId];

        if (selectedMap) {
            // On CLONE les données pour ne pas modifier l'original en mémoire
            // On ajoute 'owner: server' pour que personne ne puisse les supprimer
            this.mapData = selectedMap.data.map(item => {
            // On récupère la définition de l'item dans le registre
            const itemDef = ITEM_REGISTRY[item.type];
            return {
                ...item,
                id: Date.now() + Math.random(),
                owner: 'server',
                // Si l'item de l'éditeur est un bloc (type 1) ou système, il est indestructible
                isDestructible: itemDef ? (itemDef.isDestructible !== false) : true
            };
        });

        } else {
            console.error("Carte introuvable, chargement par défaut");
            this.mapData = [
                { id: 1000, type: 90, x: 64, y: 544, owner: 'server' },
                { id: 1001, type: 91, x: 736, y: 544, owner: 'server' }
            ];   
        }

        // 2. On force la redirection de tout le monde
        this.broadcast('redirectGame', { url: `/game.html?room=${this.code}` });

        console.log(`[${this.code}] Chargement de la partie...`);

        // 3. On attend 4 secondes que tout le monde soit connecté sur game.html
        // avant de lancer le DRAFT
        setTimeout(() => {
            this.startDraftPhase();
        }, 4000);
    }

    startDraftPhase() {
        this.state = 'DRAFT';
        this.round++;
        console.log(`[${this.code}] Phase DRAFT (Filtre actif)`);    

        // On ne prend que les items qui sont dans ITEM_REGISTRY ET dans config.allowedItems
        const globalAvailableIds = Object.keys(ITEM_REGISTRY).filter(id => {
            const isSystem = ITEM_REGISTRY[id].isSystem;
            const isAllowed = this.config.allowedItems.includes(parseInt(id));
            return !isSystem && isAllowed;
        });

        for (let pId in this.players) {
            this.players[pId].selectedItem = null;
            this.players[pId].hasFinished = false;
            this.players[pId].hasPlaced = false; 
            
            const options = [];
            // 2. On fait une copie de la liste pour ce joueur précis
            let playerPool = [...globalAvailableIds];
            
            for(let i=0; i<3; i++) {
                // Si jamais on a moins de 3 objets dans le registre, on s'arrête
                if(playerPool.length === 0) break;

                // 3. On tire un index au hasard dans le pool actuel
                const randomIndex = Math.floor(Math.random() * playerPool.length);
                const selectedId = playerPool[randomIndex];
                
                options.push(ITEM_REGISTRY[selectedId]);
                
                // 4. On retire l'ID pioché du pool pour ne pas le ravoir au prochain tour de boucle
                playerPool.splice(randomIndex, 1);
            }
            this.draftOptions[pId] = options;
        }

        this.broadcast('gameState', { 
            state: 'DRAFT', 
            round: this.round, 
            options: this.draftOptions,
            roomConfig: { mode: this.config.gameMode } // <-- Info importante
        });
        this.startTimer(10, () => this.startPlacementPhase());
    }

    startPlacementPhase() {
        this.state = 'PLACEMENT';
        for (let pId in this.players) {
            if (!this.players[pId].selectedItem) {
                this.players[pId].selectedItem = ITEM_REGISTRY[1];
            }
        }
        
        this.broadcast('gameState', { 
            state: 'PLACEMENT', 
            players: this.players, 
            map: this.mapData 
        });
        
        this.startTimer(15, () => this.startRunPhase());
    }

    startRunPhase() {
        this.state = 'RUN';
        this.stopTimer();
        
        // Reset des états de mort pour le nouveau round
        for(let pId in this.players) {
            this.players[pId].isDead = false; 
        }

        this.broadcast('gameState', { state: 'RUN', map: this.mapData });
        
        // On utilise la valeur de la config
        this.startTimer(this.config.runTime, () => this.startScorePhase());
    }

    startScorePhase() {
        this.state = 'SCORE';
        this.stopTimer();

        let winner = null;
        for(let pId in this.players) {
            if(this.players[pId].score >= 50) winner = this.players[pId];
        }

        this.broadcast('gameState', { state: 'SCORE', players: this.players, winner: winner });

        if (!winner) {
            this.startTimer(5, () => this.startDraftPhase());
        } else {
            this.startTimer(8, () => {
                this.state = 'LOBBY';
                this.mapData = [];
                for(let p in this.players) this.players[p].score = 0;
                this.broadcast('forceRedirect', '/');
            });
        }
    }

    placeItem(playerId, x, y, rotation = 0) {
        if (this.state !== 'PLACEMENT') return;
        const player = this.players[playerId];
        if (!player || !player.selectedItem || player.hasPlaced) return;

        const gridX = Math.floor(x / GRID_SIZE) * GRID_SIZE;
        const gridY = Math.floor(y / GRID_SIZE) * GRID_SIZE;

        // --- ANCIENNE PROTECTION (A SUPPRIMER) ---
        // if (gridX < 100 || gridX > 700) return; 

        // --- NOUVELLE PROTECTION DYNAMIQUE ---
        // On cherche les objets Départ (90) et Arrivée (91) dans la map actuelle
        const startPoint = this.mapData.find(i => i.type === 90);
        const endPoint = this.mapData.find(i => i.type === 91);

        // Fonction locale pour vérifier si on est dans la zone interdite d'un point
        const isProtected = (point) => {
            if (!point) return false;
            
            // Largeur : 1 bloc de chaque côté (donc la position X doit être entre point.x - 32 et point.x + 32)
            // Math.abs calcule l'écart absolu. Si l'écart est <= 32, on est dedans.
            const xMatch = Math.abs(gridX - point.x) <= GRID_SIZE;

            // Hauteur : 2 blocs au-dessus (Phaser : Y diminue quand on monte)
            // La zone va de point.y (le sol) jusqu'à point.y - 64 (2 blocs plus haut)
            const yMatch = (gridY <= point.y) && (gridY >= point.y - (GRID_SIZE * 2));

            return xMatch && yMatch;
        };

        // Si on tente de placer sur le Départ ou l'Arrivée, on annule
        if (isProtected(startPoint) || isProtected(endPoint)) {
            // Optionnel : Tu pourrais envoyer un message d'erreur au client ici
            return;
        }
        // -------------------------------------

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
        const activePlayers = Object.values(this.players); 
        const allDone = activePlayers.every(p => p.hasPlaced);
        if (allDone && activePlayers.length > 0) {
            this.startRunPhase();
        }
    }

    checkEndRoundCondition() {
        if (this.state !== 'RUN') return;

        const players = Object.values(this.players);
        const totalPlayers = players.length;
        if (totalPlayers === 0) return;

        if (this.config.gameMode === 'perma') {
            // MODE MORT SUBITE :
            // La manche s'arrête s'il ne reste plus personne "en jeu".
            // Un joueur est "en jeu" s'il n'est NI mort, NI arrivé.
            const activeCount = players.filter(p => !p.isDead && !p.hasFinished).length;

            if (activeCount === 0) {
                console.log(`[${this.code}] Fin (Perma) : Tous morts ou arrivés.`);
                this.startScorePhase();
            }
        } else {
            // MODE CLASSIQUE (Respawn) :
            // La manche s'arrête seulement quand TOUT LE MONDE est arrivé.
            // (Les morts ne comptent pas car ils respawnent).
            const finishedCount = players.filter(p => p.hasFinished).length;

            if (finishedCount === totalPlayers) {
                console.log(`[${this.code}] Fin (Classique) : Tous arrivés.`);
                this.startScorePhase();
            }
        }
    }

    playerFinished(playerId) {
        if (this.state !== 'RUN') return;
        const p = this.players[playerId];
        
        // On vérifie qu'il n'a pas déjà fini pour ne pas compter les points en double
        if (p && !p.hasFinished) {
            p.hasFinished = true;
            
            // Calcul des points (Bonus pour le premier)
            const finishers = Object.values(this.players).filter(pl => pl.hasFinished).length;
            const points = finishers === 1 ? 3 : 1;
            p.score += points;
            
            this.broadcast('playerGoal', { id: playerId, points });
            
            // VÉRIFICATION DE FIN DE MANCHE (Corrigé)
            this.checkEndRoundCondition();
        }
    }

    handlePlayerDeath(playerId, posData) {
        if (this.state !== 'RUN') return;

        const p = this.players[playerId];
        if (p && !p.isDead) {
            p.isDead = true;
            console.log(`[${this.code}] Joueur ${playerId} mort.`);

            // --- NOUVEAU : BROADCAST DE L'EFFET ---
            // Si on a reçu une position valide du client
            if (posData && posData.x !== undefined && posData.y !== undefined) {
                this.broadcast('playerDeathEffect', {
                    id: playerId,
                    x: posData.x,
                    y: posData.y,
                    color: p.color // On envoie aussi la couleur du joueur pour un effet stylé
                });
            }

            // vérification de fin de manche y
            this.checkEndRoundCondition();
        }
    }
}

module.exports = GameRoom;