// server/games/liars/LiarsGame.js

class LiarsGame {
    constructor(room, config) {
        this.room = room;
        this.io = room.io;
        this.code = room.code;
        this.type = 'liars';
        
        this.players = {};
        this.playerList = []; 
        this.turnIndex = 0;
        
        this.state = 'LOADING'; 
        this.tableValue = 'K'; 
        this.stack = [];
        this.lastPlay = null; 
        this.deckComposition = {}; // Pour l'annonce
    }

    init() {
        console.log(`[Liars] Init Room ${this.code}`);
        
        Object.values(this.room.players).forEach(p => {
            this.players[p.id] = {
                id: p.id,
                name: p.name,
                color: p.color,
                hand: [],
                isDead: false,
                bullets: 0
            };
        });
        
        // On récupère les IDs, mais l'ordre final sera décidé par la roulette
        this.playerList = Object.keys(this.players);
        
        // Redirection
        this.io.to(this.code).emit('redirectGame', { url: `/liars.html?room=${this.code}` });
        
        // Au lieu de startNewRound, on lance la ROULETTE
        setTimeout(() => this.startTurnDetermination(), 4000);
    }

    startTurnDetermination() {
        this.state = 'ROULETTE';
        
        // 1. MÉLANGE DE L'ORDRE DES JOUEURS (Shuffle)
        // Cela définit l'ordre de jeu pour toute la partie
        this.playerList = this.playerList.sort(() => Math.random() - 0.5);
        this.turnIndex = 0; // Le premier de la liste commencera

        const winnerId = this.playerList[0];
        
        console.log(`[Liars] Ordre défini. Premier joueur : ${this.players[winnerId].name}`);

        // 2. Envoi du signal d'animation
        this.io.to(this.code).emit('rouletteTurn', {
            winnerId: winnerId,
            duration: 4000 // Durée de l'animation
        });

        // 3. Lancement de la première manche après l'animation (+ délai lecture)
        setTimeout(() => {
            this.startNewRound();
        }, 5500); 
    }

    // --- LOGIQUE CŒUR DU JEU ---

    startNewRound() {
        const survivors = this.playerList.filter(id => !this.players[id].isDead);
        
        if (survivors.length <= 1 && this.playerList.length > 1) { this.endGame(survivors[0]); return; }
        if (survivors.length === 0 && this.playerList.length > 0) { this.endGame(null); return; }

        this.state = 'PLAYING';
        this.stack = [];
        this.lastPlay = null;

        // --- GÉNÉRATION DU DECK ---
        const numPlayers = survivors.length;
        const numJokers = numPlayers; 
        const numRegular = (numPlayers * 5) - numJokers; 
        const types = ['Q', 'K', 'A']; 
        let deck = [];
        for (let i = 0; i < numJokers; i++) deck.push('JOKER');
        let typeIndex = 0;
        for (let i = 0; i < numRegular; i++) {
            deck.push(types[typeIndex]);
            typeIndex = (typeIndex + 1) % types.length;
        }
        deck = deck.sort(() => Math.random() - 0.5);

        this.deckComposition = { 'Q': 0, 'K': 0, 'A': 0, 'JOKER': 0 };
        deck.forEach(c => this.deckComposition[c] = (this.deckComposition[c] || 0) + 1);

        const availableTypes = types.filter(t => this.deckComposition[t] > 0);
        this.tableValue = availableTypes[Math.floor(Math.random() * availableTypes.length)];

        survivors.forEach(id => {
            this.players[id].hand = deck.splice(0, 5);
        });
        this.playerList.forEach(id => {
            if (this.players[id].isDead) this.players[id].hand = [];
        });

        this.advanceTurn(false);

        // --- SÉQUENCE DE LANCEMENT CORRIGÉE ---

        // 1. CRITIQUE : On envoie l'état MAINTENANT pour que le client affiche les avatars des joueurs
        // Sans ça, l'animation de distribution ne trouve pas les cibles et plante au premier tour.
        this.io.to(this.code).emit('gameState', this.buildStateData());

        // 2. Annonce du Deck
        this.io.to(this.code).emit('deckAnnouncement', this.deckComposition);

        // 3. Calcul dynamique du temps d'animation
        // Formule client : (5 cartes * N joueurs * 150ms) + 600ms de vol
        const cardsCount = 5;
        const dealSpeed = 150;
        // On ajoute 1000ms de marge de sécurité pour éviter les coupures
        const animDuration = (cardsCount * survivors.length * dealSpeed) + 1500;

        // 4. Lancement de l'animation visuelle
        this.io.to(this.code).emit('dealingAnimation', {
            targets: survivors,
            cardCount: cardsCount
        });

        // 5. Envoi des mains secrètes (pour que le client sache quoi afficher quand la carte arrive)
        for (let pid in this.players) {
             const socketId = Object.keys(this.room.sockets).find(k => this.room.sockets[k] === pid);
             if (socketId) {
                 this.io.to(socketId).emit('handUpdate', this.players[pid].hand);
             }
        }

        // 6. On attend la fin précise de l'animation avant de confirmer l'état
        // (Même si gameState est déjà envoyé en 1, cela permet de resynchroniser tout le monde)
        setTimeout(() => {
            this.broadcastState(); 
        }, animDuration);
    }

    // Modifie cette fonction pour ajouter le cas 'passTurn'
    handleClientEvent(event, socketId, data) {
        const playerId = this.room.sockets[socketId];
        if (!playerId || !this.players[playerId]) return;

        // Reconnexion / Sync
        if (event === 'joinGamePhase') {
            this.sendStateToPlayer(socketId);
            if (this.players[playerId].hand.length > 0) {
                this.io.to(socketId).emit('handUpdate', this.players[playerId].hand);
            }
            if (this.deckComposition) {
                this.io.to(socketId).emit('deckAnnouncement', this.deckComposition);
            }
            return;
        }

        if (this.state !== 'PLAYING') return; 
        if (this.players[playerId].isDead) return;
        if (this.playerList[this.turnIndex] !== playerId) return;

        if (event === 'playCards') this.handlePlayCards(playerId, data.cardIndices);
        else if (event === 'callLiar') this.handleChallenge(playerId);
        else if (event === 'passTurn') this.handlePassTurn(playerId); // <-- NOUVEAU
    }

    handlePlayCards(playerId, indices) {
        const player = this.players[playerId];
        if (!indices || indices.length === 0 || indices.length > 3) return;
        
        indices.sort((a, b) => b - a); 
        
        const playedCards = [];
        indices.forEach(idx => {
            if (player.hand[idx]) {
                playedCards.push(player.hand[idx]);
                player.hand.splice(idx, 1);
            }
        });

        // AJOUT : On envoie le signal d'animation MAINTENANT
        // On le fait avant broadcastState pour que l'animation parte
        this.io.to(this.code).emit('playAnimation', {
            playerId: playerId,
            count: playedCards.length
        });

        this.stack.push(...playedCards);
        this.lastPlay = {
            playerId: playerId,
            playerName: player.name,
            count: playedCards.length,
            actualCards: playedCards 
        };

        this.advanceTurn(true);
        this.broadcastState();
    }

    // Ajoute cette nouvelle fonction
    handlePassTurn(playerId) {
        // On n'autorise à passer que si on n'a plus de cartes (sinon on doit jouer)
        if (this.players[playerId].hand.length > 0) return;

        console.log(`[Liars] ${this.players[playerId].name} passe son tour.`);

        // C'est MAINTENANT qu'on vérifie si tout le monde est vide
        // Si je passe (car j'ai 0 cartes) et que tout le monde est vide, ALORS on redistribue.
        if (this.checkIfAllEmpty()) {
            this.io.to(this.code).emit('infoMessage', "Tout le monde a passé. Redistribution...");
            setTimeout(() => this.startNewRound(), 3000);
            return;
        }

        // Sinon, au suivant
        this.advanceTurn(true);
        this.broadcastState();
    }

    // Vérifie si tous les joueurs vivants ont vidé leur main
    checkIfAllEmpty() {
        return this.playerList.every(id => {
            const p = this.players[id];
            return p.isDead || p.hand.length === 0;
        });
    }

handleChallenge(challengerId) {
        if (!this.lastPlay) return;

        const victimId = this.lastPlay.playerId;
        const playedCards = this.lastPlay.actualCards;
        const required = this.tableValue;

        // VERDICT
        const isLie = playedCards.some(card => card !== required && card !== 'JOKER');
        let loserId = isLie ? victimId : challengerId;
        
        this.io.to(this.code).emit('showdown', {
            cards: playedCards,
            liar: isLie,
            loser: loserId,
            winner: isLie ? challengerId : victimId
        });

        // --- CALCUL DU DÉLAI DYNAMIQUE ---
        // Côté Client : 1s par carte + 1.5s avant affichage du texte
        // On ajoute 2s de plus pour laisser le temps de lire "MENSONGE" ou "VÉRITÉ"
        const animTime = (playedCards.length * 1000) + 1500;
        const readingTime = 2000;
        const totalDelay = animTime + readingTime;

        // On lance la roulette russe seulement après ce délai
        setTimeout(() => {
            this.triggerRussianRoulette(loserId);
        }, totalDelay);
    }

    triggerRussianRoulette(playerId) {
        const victim = this.players[playerId];

        const chambersLeft = 6 - victim.bullets;

    // Sécurité (ne devrait jamais arriver)
    if (chambersLeft <= 0) {
        victim.isDead = true;
        this.io.to(this.code).emit('gunshot', { target: playerId, status: 'DEAD' });
        setTimeout(() => this.startNewRound(), 4000);
        return;
    }

    // Proba réelle de roulette russe
    const isFatal = Math.random() < (1 / chambersLeft); 

        if (isFatal) {
            victim.isDead = true;
            this.io.to(this.code).emit('gunshot', { target: playerId, status: 'DEAD' });
        } else {
            victim.bullets++;
            this.io.to(this.code).emit('gunshot', { target: playerId, status: 'ALIVE' });
        }

        // DANS TOUS LES CAS : On relance une distribution à zéro après le tir
        setTimeout(() => {
            this.startNewRound();
        }, 4000);
    }

    advanceTurn(changePlayer) {
        if (changePlayer) {
            this.turnIndex = (this.turnIndex + 1) % this.playerList.length;
        }
        
        let loops = 0;
        // On saute les morts
        while (this.players[this.playerList[this.turnIndex]].isDead && loops < this.playerList.length) {
            this.turnIndex = (this.turnIndex + 1) % this.playerList.length;
            loops++;
        }
    }

    endGame(winnerId) {
        this.state = 'GAME_OVER';
        this.broadcastState();
        setTimeout(() => this.io.to(this.code).emit('forceRedirect', '/'), 5000);
    }

    sendStateToPlayer(socketId) {
        this.io.to(socketId).emit('gameState', this.buildStateData());
    }

    // --- CORRECTION BUG "CARTES NE DISPARAISSENT PAS" ---
    broadcastState() {
        const stateData = this.buildStateData();
        this.io.to(this.code).emit('gameState', stateData);
        
        // Au lieu de chercher UN seul socket, on envoie à TOUS les sockets qui correspondent au joueur.
        // Cela gère les cas où l'utilisateur a rafraîchi et a un nouveau socket ID.
        for (let pid in this.players) {
             const playerHand = this.players[pid].hand;
             
             // On parcourt tous les sockets de la room
             Object.keys(this.room.sockets).forEach(socketId => {
                 // Si ce socket appartient à ce joueur
                 if (this.room.sockets[socketId] === pid) {
                     this.io.to(socketId).emit('handUpdate', playerHand);
                 }
             });
        }
    }
    
    buildStateData() {
        const publicPlayers = {};
        for (let pid in this.players) {
            const p = this.players[pid];
            publicPlayers[pid] = {
                id: p.id,
                name: p.name,
                color: p.color,
                cardCount: p.hand.length,
                isDead: p.isDead,
                bullets: p.bullets,
                isMyTurn: (pid === this.playerList[this.turnIndex])
            };
        }
        return {
            state: this.state,
            tableValue: this.tableValue,
            stackCount: this.stack.length,
            lastPlay: this.lastPlay ? { name: this.lastPlay.playerName, count: this.lastPlay.count } : null,
            players: publicPlayers,
            turnId: this.playerList[this.turnIndex]
        };
    }
    
    onPlayerDisconnect(socketId) {}
}


module.exports = LiarsGame;
