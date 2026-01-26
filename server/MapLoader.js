// server/MapLoader.js
const fs = require('fs');
const path = require('path');

const mapDir = path.join(__dirname, '../maps'); // Attention au chemin relatif '../'

function loadMaps() {
    const maps = {};
    
    if (!fs.existsSync(mapDir)) {
        console.log(">> Dossier 'maps' introuvable !");
        return maps;
    }

    fs.readdirSync(mapDir).forEach(file => {
        if (file.endsWith('.json')) {
            try {
                const content = fs.readFileSync(path.join(mapDir, file));
                const mapObj = JSON.parse(content);
                const mapId = file.replace('.json', '');
                maps[mapId] = mapObj;
                console.log(`>> Carte chargée: ${mapId} (${mapObj.name})`);
            } catch (e) {
                console.error(`Erreur chargement map ${file}:`, e);
            }
        }
    });
    
    return maps;
}

module.exports = { loadMaps };