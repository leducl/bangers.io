
const ClientItemLogic = {
    // Stockage des groupes physiques (Flèches, Boules de feu, etc.)
    groups: {},

    /**
     * INITIALISATION (Appelé UNE FOIS dans create())
     * Sert à préparer les groupes de projectiles et les textures
     */
    init: function(scene, solidGroup) {
        this.scene = scene;
        this.solidGroup = solidGroup;

        // --- 1. Groupe des Projectiles (Pour les arbalètes, canons...) ---
        this.groups.projectiles = scene.physics.add.group({
            allowGravity: false,
            immovable: false
        });

        // --- 2. Génération de textures "in-memory" si pas d'image ---
        if (!scene.textures.exists('arrow_texture')) {
            const gfx = scene.make.graphics();
            gfx.fillStyle(0xffffff);
            gfx.fillRect(0, 0, 16, 4); // Flèche simple
            gfx.generateTexture('arrow_texture', 16, 4);
            gfx.destroy();
        }

        // --- 3. Collisions Globales des Projectiles ---
        // Projectiles vs Murs
        scene.physics.add.collider(this.groups.projectiles, solidGroup, (proj, wall) => {
            proj.destroy();
        });

        // Projectiles vs Bord du monde
        scene.physics.world.on('worldbounds', (body) => {
            if (body.gameObject.getData('isProjectile')) {
                body.gameObject.destroy();
            }
        });
    },

    /**
     * LOGIQUE PAR OBJET (Appelé quand un objet est spawn)
     */
    behaviors: {
        // ID 8 : ARBALÈTE
        8: (scene, itemObject) => {
            scene.time.addEvent({
                delay: 2000,
                loop: true,
                callback: () => {
                    if (!itemObject.scene) return;

                    // 1. Récupérer l'angle de l'arbalète
                    const angle = itemObject.angle || 0;
                    
                    // 2. Calculer le point de spawn (Sortie du canon)
                    // Par défaut, l'arbalète tire à gauche (-20px).
                    // On utilise la trigo pour faire tourner ce point autour du centre (x,y)
                    
                    // Phaser : 0 degrés = Droite. 180 = Gauche.
                    // Si ton sprite pointe à gauche par défaut, il est visuellement à 0° mais "logiquement" à 180°.
                    // Pour simplifier : On va dire que l'angle de tir = angle de l'objet + 180 (pour tirer à gauche quand rotation 0)
                    
                    const shootAngle = angle + 180; 
                    
                    // Création Vectorielle pour le spawn et la vitesse
                    const vec = scene.physics.velocityFromAngle(shootAngle, 20); // 20px de décalage
                    const spawnX = itemObject.x + vec.x;
                    const spawnY = itemObject.y + vec.y;

                    const arrow = ClientItemLogic.groups.projectiles.create(spawnX, spawnY, 'arrow_texture');
                    
                    arrow.setData('isProjectile', true);
                    arrow.setData('deadly', true);
                    
                    // 3. Donner la vitesse selon l'angle
                    const velocity = scene.physics.velocityFromAngle(shootAngle, 400); // Vitesse 400
                    arrow.setVelocity(velocity.x, velocity.y);
                    
                    // 4. Tourner la flèche pour qu'elle pointe dans la bonne direction
                    arrow.setAngle(shootAngle);

                    arrow.body.setSize(16, 4); // Ajuster selon l'orientation si besoin (si tir vertical, inverser W/H ?)
                    // Pour être parfait, si tir vertical, la hitbox devrait être 4x16 :
                    if (Math.abs(velocity.y) > Math.abs(velocity.x)) {
                        arrow.body.setSize(4, 16);
                    } else {
                        arrow.body.setSize(16, 4);
                    }

                    arrow.setCollideWorldBounds(true);
                    arrow.body.onWorldBounds = true;
                }
            });
        },

        // EXEMPLE FUTUR : ID 12 (Tourelle qui vise le joueur)
        /*
        12: (scene, itemObject) => {
            // Logique de visée ici...
        }
        */
    },

    /**
     * APPLIQUER LA LOGIQUE (Appelé par spawnItem)
     */
    apply: function(itemObject, typeId) {
        if (this.behaviors[typeId]) {
            this.behaviors[typeId](this.scene, itemObject);
        }
    },

    /**
     * VÉRIFICATION COLLISIONS JOUEUR (Appelé dans update)
     * Vérifie si le joueur touche un projectile mortel géré par ce système
     */
    checkCollisions: function(player) {
        if (!this.groups.projectiles) return;

        // On vérifie l'overlap entre le joueur et TOUS les projectiles
        this.scene.physics.overlap(player, this.groups.projectiles, (p, proj) => {
            if (proj.getData('deadly')) {
                p.die(); // Le joueur meurt
                proj.destroy(); // Le projectile disparaît
            }
        });
    }
};

// Compatibilité navigateur
window.ClientItemLogic = ClientItemLogic;