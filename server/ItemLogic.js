// server/ItemLogic.js

/**
 * Ce module gère les effets CÔTÉ SERVEUR des items.
 * Par exemple : détruire le décor, changer le score, téléporter, etc.
 */

const ItemLogic = {
    // ID 7 = Bombe
    7: (room, itemInstance) => {
        // La logique qu'on avait dans server.js, maintenant isolée ici
        console.log(`[ItemLogic] Explosion de bombe en ${itemInstance.x}, ${itemInstance.y}`);
        
        const explosionRadius = 50; 

        // 1. Supprimer la bombe elle-même
        // On cherche l'index actuel car il a pu changer
        const index = room.mapData.findIndex(i => i.id === itemInstance.id);
        if (index !== -1) room.mapData.splice(index, 1);

        // 2. Détruire les blocs destructibles autour
        const initialCount = room.mapData.length;
        
        room.mapData = room.mapData.filter(target => {
            const dx = target.x - itemInstance.x;
            const dy = target.y - itemInstance.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < explosionRadius) {
                // Si indestructible (éditeur), on garde (return true)
                // Sinon on supprime (return false)
                return target.isDestructible === false;
            }
            return true;
        });

        // 3. Notifier les joueurs si la map a changé
        if (room.mapData.length !== initialCount || index !== -1) {
             room.broadcast('gameState', { 
                state: room.state, 
                map: room.mapData 
                // On n'est pas obligé de renvoyer 'players' si seuls les blocs changent
            });
            
            // Optionnel : Envoyer un événement pour l'effet visuel
            room.broadcast('explosionEffect', { x: itemInstance.x, y: itemInstance.y });
        }
    },

    // Tu pourras ajouter d'autres IDs ici facilement
    // Exemple : 
    // 8: (room, item) => { ... logique d'une potion ... }
};

module.exports = ItemLogic;