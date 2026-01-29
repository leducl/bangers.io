// server/ItemLogic.js

const ItemLogic = {
    // ID 7 : BOMBE CLASSIQUE (Casse les blocs uniquement)
    7: (room, itemInstance) => {
        const explosionRadius = 60; // Rayon mortel (en pixels)

        // 1. Supprimer la bombe de la liste
        const index = room.mapData.findIndex(i => i.id === itemInstance.id);
        if (index !== -1) room.mapData.splice(index, 1);

        // 2. Détruire les blocs destructibles (Côté Serveur)
        room.mapData = room.mapData.filter(target => {
            const dx = target.x - itemInstance.x;
            const dy = target.y - itemInstance.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < explosionRadius && target.isDestructible !== false) {
                return false; 
            }
            return true;
        });

        // 3. Mettre à jour la map
        room.broadcast('gameState', { state: room.state, map: room.mapData });
        
        // 4. SIGNAL EXPLOSION : On envoie la position ET le rayon
        room.broadcast('explosionEffect', { 
            x: itemInstance.x, 
            y: itemInstance.y, 
            radius: explosionRadius, // <-- Important pour tuer le joueur
            type: 'classic' 
        });
    },

    // ID 10 : NUKE (Tue tout le monde + optionnellement casse la bombe elle-même)
    10: (room, itemInstance) => {
        console.log(`[ItemLogic] NUKE déclenchée par un joueur !`);

        // 1. On supprime l'objet Nuke de la map (pour qu'elle ne ré-explose pas)
        const index = room.mapData.findIndex(i => i.id === itemInstance.id);
        if (index !== -1) room.mapData.splice(index, 1);
        
        // Mise à jour de la map (la nuke disparaît)
        room.broadcast('gameState', { state: room.state, map: room.mapData });

        // 2. SIGNAL MORTEL : On dit à tous les clients "Mourez !"
        room.broadcast('nukeDetonated', { x: itemInstance.x, y: itemInstance.y });
    }
};

module.exports = ItemLogic;