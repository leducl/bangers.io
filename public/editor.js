/**
 * NETPARTY LEVEL EDITOR V2
 */

const canvas = document.getElementById('levelCanvas');
const ctx = canvas.getContext('2d');
const paletteDiv = document.getElementById('palette');

// Config
const GRID_SIZE = 32;
const WIDTH = 800;
const HEIGHT = 600;
const COLS = WIDTH / GRID_SIZE;
const ROWS = HEIGHT / GRID_SIZE;

// État
let mapData = []; 
let selectedType = 1; 
let currentTool = 'brush'; // 'brush', 'fill', 'eraser'
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
        
        // Si on glisse avec le clic enfoncé (sauf pour le pot de peinture)
        if(isMouseDown && currentTool !== 'fill') {
            handleAction(e);
        }
        render(); // On redessine pour mettre à jour le Ghost
    });

    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Raccourcis Clavier
    document.addEventListener('keydown', (e) => {
        if(e.target.tagName === 'INPUT') return; // Ne pas trigger si on tape le nom
        switch(e.key.toLowerCase()) {
            case 'b': setTool('brush'); break;
            case 'f': setTool('fill'); break;
            case 'e': setTool('eraser'); break;
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
    // Si on sélectionne un item, on passe automatiquement en pinceau
    if(currentTool === 'eraser') setTool('brush');
    
    document.querySelectorAll('.palette-item').forEach(el => el.classList.remove('selected'));
    if(divElement) divElement.classList.add('selected');
    else {
        // Fallback si on change via code
        const items = document.querySelectorAll('.palette-item');
        // Logique simplifiée pour retrouver le bon div, optionnel
    }
}

function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    // Sélection visuelle du bouton
    const index = tool === 'brush' ? 0 : tool === 'fill' ? 1 : 2;
    document.querySelectorAll('.tool-btn')[index].classList.add('active');
}

// --- 3. LOGIQUE D'ÉDITION ---

function handleAction(e) {
    const gridX = Math.floor(mouseX / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.floor(mouseY / GRID_SIZE) * GRID_SIZE;

    // Hors limites
    if (gridX < 0 || gridX >= WIDTH || gridY < 0 || gridY >= HEIGHT) return;

    // Clic Droit = Gomme temporaire
    if (e.buttons === 2) {
        removeBlockAt(gridX, gridY);
        return;
    }

    // Outils Principaux
    if (currentTool === 'eraser') {
        removeBlockAt(gridX, gridY);
    } 
    else if (currentTool === 'brush') {
        placeBlockAt(gridX, gridY, selectedType);
    } 
    else if (currentTool === 'fill') {
        // On ne remplit que sur le clic initial (pas le drag)
        if(e.type === 'mousedown') {
            floodFill(gridX, gridY, selectedType);
        }
    }
}

function placeBlockAt(x, y, type) {
    // Optimisation : si c'est déjà le bon bloc, on ne fait rien
    const existing = mapData.find(i => i.x === x && i.y === y);
    if(existing && existing.type == type) return;

    removeBlockAt(x, y);
    mapData.push({ type: parseInt(type), x: x, y: y });
}

function removeBlockAt(x, y) {
    mapData = mapData.filter(item => item.x !== x || item.y !== y);
}

// Algorithme de remplissage (Flood Fill)
function floodFill(startX, startY, fillType) {
    // Quel est le type qu'on remplace ?
    const targetItem = mapData.find(i => i.x === startX && i.y === startY);
    const targetType = targetItem ? targetItem.type : null; // null = vide

    // Si on essaie de remplir avec la même couleur, on arrête
    if (targetType == fillType) return;

    const stack = [{x: startX, y: startY}];
    const processed = new Set(); // Pour éviter les boucles infinies

    while(stack.length > 0) {
        const {x, y} = stack.pop();
        const key = `${x},${y}`;
        
        if(processed.has(key)) continue;
        if(x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;

        // Vérifier si la case actuelle correspond au type ciblé
        const currentItem = mapData.find(i => i.x === x && i.y === y);
        const currentType = currentItem ? currentItem.type : null;

        if(currentType === targetType) {
            placeBlockAt(x, y, fillType);
            processed.add(key);

            // Ajouter les voisins
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

    // Blocs
    mapData.forEach(item => drawItem(ctx, item.type, item.x, item.y, 1));

    // --- GHOST (PRÉVISUALISATION) ---
    // On dessine l'outil actuel sous la souris
    const gx = Math.floor(mouseX / GRID_SIZE) * GRID_SIZE;
    const gy = Math.floor(mouseY / GRID_SIZE) * GRID_SIZE;

    if (gx >= 0 && gx < WIDTH && gy >= 0 && gy < HEIGHT) {
        // Cadre de sélection
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.strokeRect(gx, gy, GRID_SIZE, GRID_SIZE);

        if (currentTool === 'brush' || currentTool === 'fill') {
            ctx.globalAlpha = 0.5; // Semi-transparent
            drawItem(ctx, selectedType, gx, gy);
            ctx.globalAlpha = 1.0;
        } else if (currentTool === 'eraser') {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            ctx.fillRect(gx, gy, GRID_SIZE, GRID_SIZE);
        }
    }
}

function drawItem(context, type, x, y) {
    const def = ITEM_REGISTRY[type];
    if (!def) return;

    if (images[type] && images[type].complete) {
        context.drawImage(images[type], x, y, 32, 32);
    } else {
        context.fillStyle = '#' + def.color.toString(16);
        context.fillRect(x + 2, y + 2, 28, 28);
    }
}

// --- 5. IO ---
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
                mapData = json.data;
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