/**
 * NETPARTY GAME CLIENT - FINAL V6
 */

let socket;
let game;
let myPlayerId;
let currentPhase = 'WAITING';

let startPos = null; 
let endPos = null; 

let spawnPoint = { x: 50, y: 500 }; // Valeur par défaut
let goalGroup; // Groupe pour l'arrivée

let pendingMapData = null;
let pendingPlayersData = null;


// --- CONFIGURATION PHASER ---
const CONFIG = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 800,
        height: 600,
        parent: 'game-container',
    },
    backgroundColor: '#222',
    pixelArt: true, // Optimise pour le pixel art
    roundPixels: true,
    physics: { 
        default: 'arcade', 
        arcade: { 
            gravity: { y: 1200 }, 
            debug: false 
        } 
    },
    scene: { preload, create, update }
};


// --- CLASSES ---
class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, color, id) {
        super(scene, x, y, 'player_base');
        scene.add.existing(this);
        scene.physics.add.existing(this);
        
        this.setTint(color);
        this.setCollideWorldBounds(true);
        this.setScale(0.8);
        
        this.body.setSize(28, 28); 
        this.body.setOffset(2, 2);
        this.body.setFriction(0, 0);

        this.id = id;
        this.isLocal = (id === myPlayerId);
        
        this.targetX = x;
        this.targetY = y;
        
        this.SPEED = 350;
        this.JUMP_FORCE = -500;
        
        this.isJumping = false;
        this.jumpStartTime = 0;
        this.coyoteTimer = 0;
        this.jumpBuffer = 0;
        this.wasJumpDown = false; // Mémoire de la touche

        this.isDead = false;
        this.lastSendTime = 0;

        if (!this.isLocal) {
            this.body.allowGravity = false;
            this.body.immovable = true;
        }
    }

    update(keys, time) {
        if (!this.isLocal) {
            this.x = Phaser.Math.Interpolation.Linear([this.x, this.targetX], 0.2);
            this.y = Phaser.Math.Interpolation.Linear([this.y, this.targetY], 0.2);
            if (this.targetX < this.x - 2) this.setFlipX(true);
            else if (this.targetX > this.x + 2) this.setFlipX(false);
            return;
        }

        if (this.isDead || currentPhase !== 'RUN') return;
        const body = this.body;
        //HERELEO
        //const isStationary = Math.abs(body.velocity.y) < 5;
        const onFloor = body.blocked.down || body.touching.down ; //|| isStationary;
        // --- 1. LECTURE FIABLE DES TOUCHES ---
        // On vérifie tout (Flèches + ZQSD)
        const isLeft = (keys.left?.isDown) || (keys.q?.isDown) || (keys.a?.isDown);
        const isRight = (keys.right?.isDown) || (keys.d?.isDown);
        
        const isJumpHeld = (keys.up?.isDown) || (keys.z?.isDown) || (keys.w?.isDown) || (keys.space?.isDown);

        // On détecte l'appui "frais" nous-même pour ne rien rater
        const isJumpJustPressed = isJumpHeld && !this.wasJumpDown;
        this.wasJumpDown = isJumpHeld;

        // --- 2. DEPLACEMENTS ---
        if (isLeft) {
            this.setFlipX(true);
            // SUPPRIME LA CONDITION (!body.blocked.left...)
            // On applique la vitesse tout le temps. Le moteur physique gérera l'arrêt.
            this.setVelocityX(-this.SPEED); 
            
        } else if (isRight) {
            this.setFlipX(false);
            // SUPPRIME LA CONDITION (!body.blocked.right...)
            this.setVelocityX(this.SPEED);
            
        } else {
            // Friction au sol... (reste inchangé)
            if (onFloor) this.setVelocityX(body.velocity.x * 0.5); 
            else this.setVelocityX(body.velocity.x * 0.9);
        }

        // --- 3. LOGIQUE DE SAUT BLINDÉE ---
        if (onFloor) this.coyoteTimer = time;
        if (isJumpJustPressed) this.jumpBuffer = time;

        const canJump = (time - this.coyoteTimer < 150); 
        const wantsJump = (time - this.jumpBuffer < 200);

        // DÉCLENCHEMENT
        if (canJump && wantsJump) {
            this.isJumping = true;
            this.jumpStartTime = time;
            this.coyoteTimer = 0; 
            this.jumpBuffer = 0;
            // On lance l'impulsion initiale
            this.setVelocityY(this.JUMP_FORCE);
        }

        // MAINTIEN DU SAUT (C'est ici que le bug est corrigé)
        if (this.isJumping) {
            const jumpDuration = time - this.jumpStartTime;

            // PHASE 1 : FORCE BRUTE (0 à 120ms)
            // On OBLIGE le joueur à monter, ignorant les micro-collisions du sol
            if (jumpDuration < 120) {
                if (!body.blocked.up) { // Sauf si on tape un VRAI plafond
                    this.setVelocityY(this.JUMP_FORCE);
                }
            }
            
            // PHASE 2 : HAUTEUR VARIABLE
            // Si on lâche la touche après la phase force brute, on coupe
            if (jumpDuration >= 120 && !isJumpHeld && body.velocity.y < 0) {
                body.velocity.y *= 0.9;
            }

            // Fin du saut si on commence à redescendre
            if (body.velocity.y > 0) {
                this.isJumping = false;
            }
        }

        // Gravité dynamique
        if (body.velocity.y > 0) body.gravity.y = 1500;
        else body.gravity.y = 1000;

        // Réseau
        if (time > this.lastSendTime) {
            socket.emit('playerMove', { x: this.x, y: this.y, anim: 'run' });
            this.lastSendTime = time + 45;
        }
    }

    die() {
        if(this.isDead) return;
        this.isDead = true;
        this.setTint(0x555555);
        this.setVelocity(0,0);
        this.setAlpha(0.5);
        
        if(currentPhase === 'RUN') {
            setTimeout(() => this.respawn(), 1500);
        }
    }

    respawn() {
        this.isDead = false;
        this.setAlpha(1);
        this.clearTint();
        
        // --- CORRECTION : Utilisation de la variable globale spawnPoint ---
        this.enableBody(true, spawnPoint.x, spawnPoint.y, true, true);
        
        this.setVelocity(0,0);
        this.targetX = spawnPoint.x;
        this.targetY = spawnPoint.y;
    }
}

// --- SCENE PRINCIPALE ---
let playerMap = {};
let solidGroup;   
let triggerGroup; 
let cursors;

let ghostItem;       
let markerGraphics;  
let mySelection = null; 
let hasPlacedItem = false; 
let currentGhostRotation = 0; // En degrés (0, 90, 180, 270)

function preload() {
    const gfx = this.make.graphics();
    gfx.fillStyle(0xffffff); gfx.fillRect(0,0,32,32);
    gfx.generateTexture('player_base', 32, 32);

    Object.keys(ITEM_REGISTRY).forEach(id => {
        const def = ITEM_REGISTRY[id];
        if (def.image) {
            this.load.image('item_' + id, 'assets/' + def.image);
        }
    });
}

function create() {
    this.cameras.main.setBackgroundColor('#333');
    
    this.physics.world.TILE_BIAS = 48;

    // 1. MURS & SOLS (Restent en StaticGroup pour la solidité)
    solidGroup = this.physics.add.staticGroup();

    if (window.ClientItemLogic) {
        ClientItemLogic.init(this, solidGroup);
    }

    // 2. PIÈGES & ITEMS (Deviennent un Groupe Dynamique "Immuable")
    // Cela permet de changer leur hitbox (setSize) sans tout casser
    triggerGroup = this.physics.add.group({
        immovable: true,     // Ne bouge pas quand on le tape
        allowGravity: false  // Ne tombe pas
    });

    // 3. ARRIVÉE (Pareil, dynamique immuable)
    goalGroup = this.physics.add.group({
        immovable: true,
        allowGravity: false
    });
    
    this.physics.world.setBoundsCollision(true, true, true, false);
    
    // Marker & Input
    markerGraphics = this.add.graphics();
    markerGraphics.lineStyle(2, 0xffff00, 1);
    markerGraphics.strokeRect(0, 0, 32, 32);
    markerGraphics.setVisible(false);

    this.keys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.UP,
        z: Phaser.Input.Keyboard.KeyCodes.Z,
        w: Phaser.Input.Keyboard.KeyCodes.W, // Pour le support QWERTY
        space: Phaser.Input.Keyboard.KeyCodes.SPACE,
        
        left: Phaser.Input.Keyboard.KeyCodes.LEFT,
        q: Phaser.Input.Keyboard.KeyCodes.Q,
        a: Phaser.Input.Keyboard.KeyCodes.A,
        
        right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        d: Phaser.Input.Keyboard.KeyCodes.D,
        
        down: Phaser.Input.Keyboard.KeyCodes.DOWN,
        s: Phaser.Input.Keyboard.KeyCodes.S
    });

    this.input.on('pointermove', (pointer) => {
        if(currentPhase === 'PLACEMENT' && !hasPlacedItem) {
            // Coordonnées grille (coin haut-gauche de la case visée)
            const gx = Math.floor(pointer.x / 32) * 32;
            const gy = Math.floor(pointer.y / 32) * 32;
            
            // Centre pour l'image fantôme
            const centerX = gx + 16;
            const centerY = gy + 16;

            markerGraphics.clear();
            markerGraphics.lineStyle(2, 0xffff00, 1);
            markerGraphics.strokeRect(gx, gy, 32, 32);
            markerGraphics.setVisible(true);

            if(ghostItem) {
                ghostItem.setPosition(centerX, centerY);

                // --- NOUVELLE LOGIQUE DE PROTECTION VISUELLE ---
                let isForbidden = false;

                // Fonction locale identique au serveur
                const checkZone = (refPos) => {
                    if (!refPos) return false;
                    // Largeur : écart de 32px max (1 bloc)
                    const xMatch = Math.abs(gx - refPos.x) <= 32;
                    // Hauteur : de la base jusqu'à 2 blocs au-dessus (64px)
                    const yMatch = (gy <= refPos.y) && (gy >= refPos.y - 64);
                    return xMatch && yMatch;
                };

                // On vérifie le Départ et l'Arrivée
                if (checkZone(startPos) || checkZone(endPos)) {
                    isForbidden = true;
                }
                // ----------------------------------------------

                if(isForbidden) {
                    ghostItem.setTint(0xff0000); // Rouge
                    markerGraphics.lineStyle(2, 0xff0000, 1);
                    markerGraphics.strokeRect(gx, gy, 32, 32);
                } else {
                    ghostItem.clearTint(); // Normal
                }
            }
        }
    });

    this.input.mouse.disableContextMenu();

    this.input.on('pointerdown', (pointer) => {
        if(currentPhase === 'PLACEMENT' && mySelection && !hasPlacedItem) {
            
            // CLIC DROIT (bouton 2) : ROTATION
            if (pointer.rightButtonDown()) {
                const def = ITEM_REGISTRY[mySelection.id];
                if (def && def.canRotate) {
                    currentGhostRotation += 90;
                    if (currentGhostRotation >= 360) currentGhostRotation = 0;
                    
                    // Appliquer visuellement sur le fantôme
                    if (ghostItem) ghostItem.setAngle(currentGhostRotation);
                }
                return; // On ne place pas l'objet, on arrête là
            }

            // CLIC GAUCHE : PLACEMENT
            const centerX = Math.floor(pointer.x / 32) * 32 + 16;
            const centerY = Math.floor(pointer.y / 32) * 32 + 16;
            
            // On envoie la rotation au serveur !
            socket.emit('tryPlaceItem', { 
                x: centerX, 
                y: centerY, 
                rotation: currentGhostRotation // <--- AJOUT
            });
        }
    });

    if (pendingMapData) { 
        console.log("Injection de la map en attente...");
        syncMap(this, pendingMapData); 
        pendingMapData = null; 
    }
    if (pendingPlayersData) { 
        syncPlayers(this, pendingPlayersData); 
        pendingPlayersData = null; 
    }
}


function update(time, delta) {
    const inputKeys = this.keys || cursors;

    // --- CORRECTION MAJEURE ICI ---
    // 1. On gère D'ABORD la physique du joueur LOCAL
    // Cela permet de mettre à jour "blocked.down" (le sol) AVANT que le joueur ne vérifie s'il peut sauter.
    if (playerMap[myPlayerId] && !playerMap[myPlayerId].isDead) {
        const p = playerMap[myPlayerId];
        
        // Collision Murs/Sol (Vital de le faire en premier)
        this.physics.collide(p, solidGroup);
    }

    // 2. ENSUITE on lance la logique du joueur (Inputs, Saut...)
    // Maintenant, le joueur sait qu'il est au sol grâce à l'étape 1.
    Object.values(playerMap).forEach(p => p.update(inputKeys, time));

    // 3. Gestion des autres interactions (Pièges, Arrivée...)
    if (playerMap[myPlayerId] && !playerMap[myPlayerId].isDead) {
        const p = playerMap[myPlayerId];
        
        // Pièges
        this.physics.overlap(p, triggerGroup, (player, item) => {
            const callback = item.getData('callback');
            if (callback) callback(player, item);
        });

        // Arrivée
        this.physics.overlap(p, goalGroup, () => {
             socket.emit('reachedGoal');
             p.disableBody(true, true);
             p.setPosition(spawnPoint.x, spawnPoint.y);
             p.targetX = spawnPoint.x; 
             p.targetY = spawnPoint.y;
        });

        // Mort chute
        if (p.y > 620) {
            p.die();
        }

        // Projectiles (Arbalètes...)
        if (window.ClientItemLogic) {
            ClientItemLogic.checkCollisions(p);
        }
    }
}

// --- FONCTIONS UTILITAIRES ---

function spawnItem(itemData) {
    const def = ITEM_REGISTRY[itemData.type];
    if (!def) return;

    const realX = itemData.x + 16;
    const realY = itemData.y + 16;
    const textureKey = def.image ? 'item_' + itemData.type : null;
    const scene = game.scene.scenes[0];

    // CAS 1 : DÉPART (90) - Juste visuel
    if (itemData.type == 90) {
        startPos = { x: itemData.x, y: itemData.y };
        spawnPoint = { x: realX, y: realY };
        if (textureKey) scene.add.image(realX, realY, textureKey);
        else scene.add.rectangle(realX, realY, 32, 32, 0x0000ff, 0.5);
        return; 
    }

    // CAS 2 : ARRIVÉE (91) - Groupe Goal
    if (itemData.type == 91) {
        endPos = { x: itemData.x, y: itemData.y };
        let obj;
        // Création dans goalGroup (Dynamique Immuable)
        if(textureKey) obj = goalGroup.create(realX, realY, textureKey);
        else obj = goalGroup.create(realX, realY, 'player_base'); 

        if(!textureKey) obj.setTint(0xffd700);
        
        // Hitbox manuelle pour le drapeau
        if (def.hitbox) {
             obj.body.setSize(def.hitbox.w, def.hitbox.h);
             obj.body.setOffset(def.hitbox.ox, def.hitbox.oy);
        }
        return;
    }

    // CAS 3 : ITEMS CLASSIQUES (Blocs vs Pièges)
    let obj;

    if (def.isSolid) {
        // --- C'EST UN MUR (Bloc) ---
        // On utilise solidGroup (Static)
        obj = solidGroup.create(realX, realY, textureKey || 'item_1');
        if (!textureKey) obj.setTint(def.color);
        
        // IMPORTANT : Pour les statiques, on utilise refreshBody() pour caler la physique
        // On ne touche PAS au setSize ici pour éviter les bugs de collision
        obj.refreshBody();
    } else {
        // --- C'EST UN PIÈGE (Pique, Scie...) ---
        // On utilise triggerGroup (Dynamique Immuable)
        obj = triggerGroup.create(realX, realY, textureKey || 'item_2');
        if (!textureKey) obj.setTint(def.color);
        
        obj.setData('id', itemData.id);
        if (def.onTouch) obj.setData('callback', def.onTouch);

        // ICI, comme c'est dynamique, on peut appliquer ta Hitbox sur mesure !
        if (def.hitbox) {
            obj.body.setSize(def.hitbox.w, def.hitbox.h);
            obj.body.setOffset(def.hitbox.ox, def.hitbox.oy);
        }
    }

    if (itemData.rotation) {
        obj.setAngle(itemData.rotation);
        // Note: Pour un bloc carré (Arbalète), pas besoin de tourner le body physique
        // Sauf si tu as des hitbox rectangulaires (ex: Ressort), là il faudrait adapter le setSize
    }

    if (window.ClientItemLogic) {
        ClientItemLogic.apply(obj, itemData.type);
    }
}

function syncMap(scene, mapData) {
    solidGroup.clear(true, true);
    triggerGroup.clear(true, true);
    goalGroup.clear(true, true);
    startPos = null;
    endPos = null;
    mapData.forEach(item => spawnItem(item));
    optimizeWalls();
}

// ... (Reste des fonctions socket/UI inchangées) ...

window.startGameClient = function(roomCode, playerName) {
    socket = io();
    
    socket.on('connect', () => {
        console.log("Connecté au serveur de jeu");
        socket.emit('joinGamePhase', { code: roomCode, name: playerName });
    });

    socket.on('timerUpdate', (time) => {
        const display = document.getElementById('timer-display');
        if(display) display.innerText = formatTime(time);
    });

    socket.on('gameState', (data) => handleStateChange(data));

    socket.on('itemPlaced', (item) => {
        if(item.owner === myPlayerId) {
            hasPlacedItem = true;
            if(ghostItem) { ghostItem.destroy(); ghostItem = null; }
            if(markerGraphics) markerGraphics.setVisible(false);
            document.getElementById('phase-display').innerText = "EN ATTENTE DES AUTRES...";
        }
        spawnItem(item);
        optimizeWalls();
    });

    socket.on('remoteMove', (data) => {
        if(playerMap[data.id]) {
            playerMap[data.id].targetX = data.x;
            playerMap[data.id].targetY = data.y;
        }
    });

    socket.on('redirectGame', (data) => window.location.href = data.url);
    socket.on('forceRedirect', (url) => window.location.href = url);
};

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function handleStateChange(data) {
    currentPhase = data.state;
    
    const scene = game.scene.getScene('MainScene'); 
    // Petite astuce : si MainScene n'est pas trouvé via getScene, on utilise la globale game
    const activeScene = scene || game.scene.scenes[0];
    const isSceneReady = activeScene && activeScene.sys && activeScene.sys.settings.active;

    document.getElementById('phase-display').innerText = currentPhase;
    document.getElementById('draft-menu').style.display = 'none';
    document.getElementById('scoreboard').style.display = 'none';

    if (data.players) {
        if(isSceneReady) syncPlayers(activeScene, data.players);
        else pendingPlayersData = data.players;
    }
    if (data.map) {
        if(isSceneReady) syncMap(activeScene, data.map);
        else pendingMapData = data.map;
    }

    switch(currentPhase) {
        case 'LOADING':
            document.getElementById('phase-display').innerText = "CHARGEMENT...";
            break;

        case 'DRAFT':
            document.getElementById('draft-menu').style.display = 'block';
            hasPlacedItem = false;
            if(markerGraphics) markerGraphics.setVisible(false);
            if(ghostItem) { ghostItem.destroy(); ghostItem = null; }
            if(myPlayerId && playerMap[myPlayerId]) playerMap[myPlayerId].respawn();
            if(data.options && myPlayerId && data.options[myPlayerId]) {
                renderDraftCards(data.options[myPlayerId]);
            }
            break;

        case 'PLACEMENT':
            hasPlacedItem = false;
            currentGhostRotation = 0;
            if(!mySelection) mySelection = { id: 1, name: "Bloc" }; 
            
            if(isSceneReady) {
                const textureKey = 'item_' + mySelection.id;
                ghostItem = activeScene.add.image(400, 300, textureKey).setAlpha(0.6);
                markerGraphics.setVisible(true);
            }
            break;

        case 'RUN':
            if(ghostItem) { ghostItem.destroy(); ghostItem = null; }
            if(markerGraphics) markerGraphics.setVisible(false);
            if(playerMap[myPlayerId]) playerMap[myPlayerId].respawn();
            break;

        case 'SCORE':
            document.getElementById('scoreboard').style.display = 'block';
            renderScoreboard(data.players, data.winner);
            break;
    }
}

function syncPlayers(scene, playersData) {
    const localName = localStorage.getItem('np_username');
    Object.values(playersData).forEach(pData => {
        if(pData.name === localName) myPlayerId = pData.id;
        if(!playerMap[pData.id]) {
            playerMap[pData.id] = new Player(scene, 50, 500, pData.color, pData.id);
        }
    });
}

function renderDraftCards(options) {
    const container = document.getElementById('draft-cards');
    container.innerHTML = "";
    if(!options) return;

    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'card';
        let visualHtml;
        if (opt.image) {
            visualHtml = `<img src="assets/${opt.image}" class="card-icon" style="object-fit: contain;">`;
        } else {
            visualHtml = `<div class="card-icon" style="background:#${opt.color.toString(16)}"></div>`;
        }
        div.innerHTML = `${visualHtml}<span>${opt.name}</span>`;
        div.onclick = () => {
            mySelection = opt;
            socket.emit('selectItem', opt.id);
            document.getElementById('draft-menu').style.display = 'none';
            document.getElementById('phase-display').innerText = "EN ATTENTE...";
        };
        container.appendChild(div);
    });
}

function renderScoreboard(players, winner) {
    const list = document.getElementById('score-list');
    list.innerHTML = "";
    const sorted = Object.values(players).sort((a,b) => b.score - a.score);
    sorted.forEach(p => {
        list.innerHTML += `<div class="score-row"><span>${p.name}</span><strong>${p.score} pts</strong></div>`;
    });
    if(winner) list.innerHTML += `<h3 style="text-align:center; color:gold; margin-top:20px">VAINQUEUR : ${winner.name} !</h3>`;
}


// --- OPTIMISATION DES MURS (ANTI-COLLAGE) ---
function optimizeWalls() {
    // On récupère tous les blocs du groupe solide
    const blocks = solidGroup.getChildren();

    blocks.forEach(block => {
        // Par défaut, tout est activé
        block.body.checkCollision.up = true;
        block.body.checkCollision.down = true;
        block.body.checkCollision.left = true;
        block.body.checkCollision.right = true;

        // On cherche les voisins pour désactiver les faces inutiles
        blocks.forEach(other => {
            if (block === other) return;

            // Arrondir les positions pour éviter les bugs de flottants
            const bx = Math.round(block.x);
            const by = Math.round(block.y);
            const ox = Math.round(other.x);
            const oy = Math.round(other.y);

            // Si j'ai un voisin JUSTE AU-DESSUS (y - 32)
            if (ox === bx && oy === by - 32) {
                block.body.checkCollision.up = false; 
            }
            
            // Si j'ai un voisin JUSTE EN-DESSOUS (y + 32)
            if (ox === bx && oy === by + 32) {
                block.body.checkCollision.down = false;
            }
            
            // (Optionnel) Si voisin à GAUCHE/DROITE (pour le sol lisse)
            if (oy === by && ox === bx - 32) block.body.checkCollision.left = false;
            if (oy === by && ox === bx + 32) block.body.checkCollision.right = false;
        });
    });
}

window.onload = () => {
    game = new Phaser.Game(CONFIG);
};


