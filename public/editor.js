/**
 * NETPARTY LEVEL EDITOR V2.1 (Avec Rotation)
 */

const canvas = document.getElementById('levelCanvas');
const ctx = canvas.getContext('2d');
const paletteDiv = document.getElementById('palette');

// Config
const GRID_SIZE = 32;
const WIDTH = 800;
const HEIGHT = 600;

// État
let mapData = []; 
let selectedType = 1; 
let currentTool = 'brush'; // 'brush', 'fill', 'eraser'
let currentRotation = 0;   // <--- NOUVEAU : Stocke l'angle actuel (0, 90, 180, 270)
let images = {}; 

// Souris
let mouseX = 0;
let mouseY = 0;
let isMouseDown = false;

// --- 1. INITIALISATION ---
function init() {
    loadImages();
    generatePalette();
    
    // Listeners Souris
    canvas.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        handleAction(e);
    });
    canvas.addEventListener('mouseup', () => isMouseDown = false);
    canvas.addEventListener('mouseleave', () => isMouseDown = false);
    
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
        
        if(isMouseDown && currentTool !== 'fill') {
            handleAction(e);
        }
        render(); 
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Raccourcis Clavier
    document.addEventListener('keydown', (e) => {
        if(e.target.tagName === 'INPUT') return; 
        switch(e.key.toLowerCase()) {
            case 'b': setTool('brush'); break;
            case 'f': setTool('fill'); break;
            case 'e': setTool('eraser'); break;
            case 'r': rotateSelection(); break; // <--- NOUVEAU
        }
    });

    render();
}

function loadImages() {
    Object.values(ITEM_REGISTRY).forEach(item => {
        if (item.image) {
            const img = new Image();
            img.src = 'assets/' + item.image;
            img.onload = () => render();
            images[item.id] = img;
        }
    });
}

// --- 2. INTERFACE & OUTILS ---
function generatePalette() {
    paletteDiv.innerHTML = '';
    Object.values(ITEM_REGISTRY).forEach(item => {
        const div = document.createElement('div');
        div.className = `palette-item ${item.id === selectedType ? 'selected' : ''}`;
        div.onclick = () => selectItem(item.id, div);
        div.title = item.name;

        if (item.image) {
            const img = document.createElement('img');
            img.src = 'assets/' + item.image;
            div.appendChild(img);
        } else {
            const colorBlock = document.createElement('div');
            colorBlock.style.width = '20px';
            colorBlock.style.height = '20px';
            colorBlock.style.background = '#' + item.color.toString(16);
            div.appendChild(colorBlock);
        }
        paletteDiv.appendChild(div);
    });
}

function selectItem(id, divElement) {
    selectedType = id;
    // Reset rotation quand on change d'item (optionnel, mais souvent plus ergonomique)
    currentRotation = 0; 

    if(currentTool === 'eraser') setTool('brush');
    
    document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('selected'));
    if(divElement) divElement.classList.add('selected');
    else {
        // Fallback simple pour la sélection visuelle
        const items = document.querySelectorAll('.palette-item');
        // (Logique complète omise pour brièveté, fonctionnelle via clic UI)
    }
    render(); // Update pour voir le ghost reset
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    
    // Mapping index boutons
    const index = tool === 'brush' ? 0 : tool === 'fill' ? 1 : (tool === 'eraser' ? 2 : -1);
    if(index >= 0) document.querySelectorAll('.tool-btn')[index].classList.add('active');
    
    render();
}

// <--- NOUVEAU : Fonction de Rotation
function rotateSelection() {
    // On ne fait tourner que si l'objet le permet (défini dans items.js)
    const def = ITEM_REGISTRY[selectedType];
    if (def && def.canRotate) {
        currentRotation += 90;
        if (currentRotation >= 360) currentRotation = 0;
        render(); // On redessine pour voir le ghost tourner
    }
}

// --- 3. LOGIQUE D'ÉDITION ---

function handleAction(e) {
    const gridX = Math.floor(mouseX / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.floor(mouseY / GRID_SIZE) * GRID_SIZE;

    if (gridX < 0 || gridX >= WIDTH || gridY < 0 || gridY >= HEIGHT) return;

    if (e.buttons === 2) { // Clic Droit = Gomme
        removeBlockAt(gridX, gridY);
        return;
    }

    if (currentTool === 'eraser') {
        removeBlockAt(gridX, gridY);
    } 
    else if (currentTool === 'brush') {
        placeBlockAt(gridX, gridY, selectedType, currentRotation);
    } 
    else if (currentTool === 'fill') {
        if(e.type === 'mousedown') {
            floodFill(gridX, gridY, selectedType, currentRotation);
        }
    }
}

// <--- MODIFIÉ : Ajout du paramètre rotation
function placeBlockAt(x, y, type, rotation = 0) {
    // Si c'est exactement le même bloc (type ET rotation), on ne fait rien
    const existing = mapData.find(i => i.x === x && i.y === y);
    if(existing && existing.type == type && existing.rotation == rotation) return;

    removeBlockAt(x, y);
    
    // On pousse l'objet avec sa rotation dans la map
    mapData.push({ 
        type: parseInt(type), 
        x: x, 
        y: y, 
        rotation: rotation 
    });
}

function removeBlockAt(x, y) {
    mapData = mapData.filter(item => item.x !== x || item.y !== y);
}

// <--- MODIFIÉ : Passe la rotation au placeBlockAt
function floodFill(startX, startY, fillType, fillRotation) {
    const targetItem = mapData.find(i => i.x === startX && i.y === startY);
    const targetType = targetItem ? targetItem.type : null; 
    
    // Attention : pour le floodfill, on compare juste les TYPES, pas les rotations
    if (targetType == fillType && targetItem?.rotation == fillRotation) return;

    const stack = [{x: startX, y: startY}];
    const processed = new Set(); 

    while(stack.length > 0) {
        const {x, y} = stack.pop();
        const key = `${x},${y}`;
        
        if(processed.has(key)) continue;
        if(x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;

        const currentItem = mapData.find(i => i.x === x && i.y === y);
        const currentType = currentItem ? currentItem.type : null;

        if(currentType === targetType) {
            placeBlockAt(x, y, fillType, fillRotation); // Utilise la rotation actuelle
            processed.add(key);

            stack.push({x: x + GRID_SIZE, y: y});
            stack.push({x: x - GRID_SIZE, y: y});
            stack.push({x: x, y: y + GRID_SIZE});
            stack.push({x: x, y: y - GRID_SIZE});
        }
    }
}

function clearMap() {
    if(confirm("Tout effacer ?")) {
        mapData = [];
        render();
    }
}

// --- 4. RENDU ---
function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    // Grille
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WIDTH; x += GRID_SIZE) { ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); }
    for (let y = 0; y <= HEIGHT; y += GRID_SIZE) { ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); }
    ctx.stroke();

    // 1. DESSIN DE LA CARTE EXISTANTE
    // On passe item.rotation à drawItem
    mapData.forEach(item => drawItem(ctx, item.type, item.x, item.y, item.rotation));

    // 2. GHOST (PRÉVISUALISATION)
    const gx = Math.floor(mouseX / GRID_SIZE) * GRID_SIZE;
    const gy = Math.floor(mouseY / GRID_SIZE) * GRID_SIZE;

    if (gx >= 0 && gx < WIDTH && gy >= 0 && gy < HEIGHT) {
        // Cadre blanc
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.strokeRect(gx, gy, GRID_SIZE, GRID_SIZE);

        if (currentTool === 'brush' || currentTool === 'fill') {
            ctx.globalAlpha = 0.5;
            // On dessine le Ghost avec la rotation actuelle (currentRotation)
            drawItem(ctx, selectedType, gx, gy, currentRotation);
            ctx.globalAlpha = 1.0;
        } else if (currentTool === 'eraser') {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            ctx.fillRect(gx, gy, GRID_SIZE, GRID_SIZE);
        }
    }
}

// <--- MODIFIÉ : Gestion de la rotation du Canvas
function drawItem(context, type, x, y, rotation = 0) {
    const def = ITEM_REGISTRY[type];
    if (!def) return;

    // Sauvegarde du contexte avant transformation
    context.save();

    // 1. Déplacer le point d'origine au CENTRE de la case (16, 16)
    const centerX = x + (GRID_SIZE / 2);
    const centerY = y + (GRID_SIZE / 2);
    context.translate(centerX, centerY);

    // 2. Appliquer la rotation (Convertir degrés en radians)
    context.rotate(rotation * Math.PI / 180);

    // 3. Dessiner l'image
    // On dessine en (-16, -16) puisque l'origine (0,0) est maintenant au centre de la case
    if (images[type] && images[type].complete) {
        context.drawImage(images[type], -GRID_SIZE/2, -GRID_SIZE/2, GRID_SIZE, GRID_SIZE);
    } else {
        // Fallback couleur
        context.fillStyle = '#' + def.color.toString(16);
        context.fillRect(-GRID_SIZE/2 + 2, -GRID_SIZE/2 + 2, 28, 28);
        
        // Petit indicateur de direction pour les blocs couleur sans image
        if (rotation !== 0 || def.canRotate) {
             context.fillStyle = 'white';
             context.fillRect(8, -2, 4, 4); // Un petit point indiquant la "droite" (0°)
        }
    }

    // 4. Restaurer le contexte pour ne pas affecter les prochains dessins
    context.restore();
}

// --- 5. IO (Export/Import) ---
function exportJSON() {
    const name = document.getElementById('levelName').value || "Niveau";
    const levelObj = { name: name, data: mapData };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(levelObj, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
}

function importJSON(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const json = JSON.parse(e.target.result);
            if (json.data) {
                // On s'assure que les données importées ont bien le champ rotation (compatibilité)
                mapData = json.data.map(item => ({
                    ...item,
                    rotation: item.rotation || 0
                }));
                if(json.name) document.getElementById('levelName').value = json.name;
                render();
            }
        } catch (err) { alert("Erreur JSON"); }
    };
    reader.readAsText(file);
    input.value = '';
}

// Start
init();