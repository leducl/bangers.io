/**
 * NETPARTY CLIENT - CORE ENGINE (CORRIGÉ)
 */

// Récupération du socket global
const socket = window.socket;

class Player extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y, color, isLocal = false) {
        super(scene, x, y, 'player');
        scene.add.existing(this);
        scene.physics.add.existing(this);
        
        this.setTint(color);
        this.setCollideWorldBounds(true);
        this.isLocal = isLocal;
        this.body.setGravityY(1000); // Gravité plus forte pour un feeling "platformer"
    }

    updatePhysics(cursors) {
        if (!this.isLocal) return;

        // Mouvement simple pour tester
        if (cursors.left.isDown) {
            this.setVelocityX(-200);
        } else if (cursors.right.isDown) {
            this.setVelocityX(200);
        } else {
            this.setVelocityX(0);
        }

        if (cursors.up.isDown && this.body.touching.down) {
            this.setVelocityY(-600);
        }
    }
}

class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
    }

    preload() {
        // Texture carrée simple générée à la volée
        const graphics = this.make.graphics().fillStyle(0xffffff).fillRect(0, 0, 32, 32);
        graphics.generateTexture('player', 32, 32);
    }

    create() {
        this.cursors = this.input.keyboard.createCursorKeys();
        
        // Sol
        const ground = this.add.rectangle(400, 580, 800, 40, 0x666666);
        this.physics.add.existing(ground, true); // true = static

        this.players = {}; // Stockage des sprites joueurs
        this.localId = socket.id;
        
        // Écoute des mises à jour une fois le jeu lancé
        socket.on('updatePlayers', (serverPlayers) => {
            this.syncPlayers(serverPlayers, ground);
        });

        // Feedback visuel de connexion
        this.add.text(10, 10, 'Jeu Lancé !', { fontSize: '16px', fill: '#0f0' });
    }

    syncPlayers(serverPlayers, ground) {
        // Ajouter les nouveaux
        Object.keys(serverPlayers).forEach(id => {
            if (!this.players[id]) {
                const pInfo = serverPlayers[id];
                const isMe = (id === this.localId);
                const p = new Player(this, pInfo.x, pInfo.y, pInfo.color, isMe);
                this.physics.add.collider(p, ground);
                this.players[id] = p;
            }
        });

        // Supprimer ceux partis (optionnel pour l'instant)
    }

    update() {
        // Boucle de jeu
        if (this.players[this.localId]) {
            const myPlayer = this.players[this.localId];
            myPlayer.updatePhysics(this.cursors);

            // Envoi de la position (TRES basique, à optimiser plus tard)
            // socket.emit('playerMove', { x: myPlayer.x, y: myPlayer.y });
        }
    }
}

const config = {
    type: Phaser.AUTO,
    width: 800, height: 600,
    parent: 'game-container',
    backgroundColor: '#2d2d2d',
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [MainScene]
};

// On initialise Phaser tout de suite, mais il est caché par CSS
window.gameInstance = new Phaser.Game(config);