// public/items.js

/**
 * REGISTRE DES OBJETS ET PIÈGES (PARTAGÉ CLIENT/SERVEUR)
 * Pour Node.js : module.exports
 * Pour Navigateur : variable globale ITEM_REGISTRY
 */

const ITEM_REGISTRY = {
    1: {
        id: 1, // IMPORTANT : On répète l'ID ici pour que le serveur puisse le lire facilement
        name: "Bloc",
        image: "block.png",
        color: 0x888888, // Ajouté pour compatibilité draft
        isSolid: true,
        isDestructible: false,
    },
    2: {
        id: 2,
        name: "Pique",
        image: "spike.png",
        color: 0xff0000,
        isSolid: false,
        canRotate: true,
        hitbox: { w: 16, h: 16, ox: 8, oy: 16 },
        onTouch: (player) => player.die()
    },
    3: {
        id: 3,
        name: "Ressort",
        image: "spring.png",
        color: 0x00ff00,
        isSolid: false,
        hitbox: { w: 32, h: 20, ox: 0, oy: 12 },
        onTouch: (player, item) => {
            if(player.body.velocity.y > 0 || player.y < item.y) {
                player.setVelocityY(-950);
            }
        }
    },
    4: {
        id: 4,
        name: "Scie",
        image: "saw.png",
        color: 0xff00ff,
        isSolid: false,
        hitbox: { w: 28, h: 28, ox: 2, oy: 2 },
        onTouch: (player) => player.die()
    },
    5: {
        id: 5,
        name: "Ventilo",
        image: "fan.png",
        color: 0x00ffff,
        isSolid: false,
        canRotate: true,
        onTouch: (player, item) => {
            const force = 450;
            
            // Calcul de l'angle (0° visuel = Haut = -90° physique)
            const angleCorrected = item.angle - 90;

            if (player.scene) {
                // 1. Vecteur de poussée du ventilo
                const vec = player.scene.physics.velocityFromAngle(angleCorrected, force);
                
                // 2. LOGIQUE DE PRIORITÉ INPUT (Anti-Bloquage)
                
                // --- AXE X (Horizontal) ---
                if (vec.x !== 0) {
                    // Est-ce que le joueur essaie d'aller CONTRE le vent ?
                    // Ex: Vent pousse à Droite (vec.x > 0) MAIS Joueur va à Gauche (vel.x < -10)
                    const fightingWind = (vec.x > 0 && player.body.velocity.x < -10) ||
                                         (vec.x < 0 && player.body.velocity.x > 10);

                    // On n'applique la force du vent QUE si le joueur ne lutte pas contre
                    if (!fightingWind) {
                        player.setVelocityX(vec.x);
                    }
                }

                // --- AXE Y (Vertical) ---
                if (vec.y !== 0) {
                    // Pour le vertical, on garde la logique de blocage simple 
                    // (pour éviter de rester collé au plafond ou au sol)
                    const pushingDownBlocked = (vec.y > 0 && player.body.blocked.down);
                    const pushingUpBlocked   = (vec.y < 0 && player.body.blocked.up);

                    if (!pushingDownBlocked && !pushingUpBlocked) {
                         player.setVelocityY(vec.y);
                    }
                }
            }
        }
    },
    6: {
        id: 6,
        name: "Colle",
        image: "glue.png", // Assure-toi d'avoir cette image ou met null
        color: 0x4a2c2a,
        isSolid: false,
        onTouch: (player) => {
            player.setVelocityX(player.body.velocity.x * 0.5);
        }
    },

    7: {
        id: 7,
        name: "Bombe",
        image: "bomb.png", // Assure-toi d'avoir l'image ou utilise le fallback couleur
        color: 0x333333,
        isSolid: false,
        isDestructible: true,
        hitbox: { w: 20, h: 20, ox: 6, oy: 6 },
        onTouch: (player, item) => {
            // On envoie un signal au serveur pour dire "Cette bombe a été touchée"
            // L'ID de l'item est stocké dans les données de l'objet Phaser
            const itemId = item.getData('id'); 
            socket.emit('triggerBomb', itemId);
        }
    },

    8: {
        id: 8,
        name: "Arbalète",
        image: "crossbow.png", // Assure-toi d'avoir une image ou le jeu utilisera un carré couleur
        color: 0x5d4037, // Marron foncé
        isSolid: true,   // L'arbalète elle-même est un bloc solide (on marche dessus)
        isDestructible: true,
        canRotate: true,    
    },

    10: {
        id: 10,
        name: "Nuke",
        image: "nuke.png", // Assure-toi d'avoir une image ou le jeu utilisera la couleur
        color: 0x00ff00,   // Vert fluo / Toxique
        isSolid: false,
        isDestructible: true,
        hitbox: { w: 24, h: 24, ox: 4, oy: 4 }, // Un peu plus grosse
        onTouch: (player, item) => {
            // Déclenche la mort de tout le monde
            const itemId = item.getData('id');
            socket.emit('triggerNuke', itemId);
        }
    },

    // --- ITEMS MAITRE ---
    90: { 
        id: 90, 
        name: "Départ", 
        color: 0x0000ff, // Bleu
        isSolid: false, // On peut marcher dessus
        isSystem: true, // Marqueur spécial
        image: "start.png", // Optionnel
        isDestructible: false,
    },
    91: { 
        id: 91, 
        name: "Arrivée", 
        color: 0xffd700, // Or
        isSolid: false,
        isSystem: true,
        image: "flag.png", // Optionnel
        isDestructible: false,
    }
};

// --- COMPATIBILITÉ NODE.JS ---
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ITEM_REGISTRY;
}