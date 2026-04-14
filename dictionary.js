// dictionary.js
export let ALL_COLORS =[];

// The HTML for the dropdown menu
const dropdownHTML = `
    <span style="font-size: 11px; color: #666; margin-right: 5px;">List:</span>
    <select id="dictionarySelect" style="background: transparent; color: grey; border: none; outline: none; cursor: pointer; font-size: 12px;">
        <optgroup label="General">
            <option value="colornames.csv">Full List (30k)</option>
            <option value="bestOf">Best of (Curated)</option>
            <option value="wikipedia">Wikipedia</option>
            <option value="xkcd">XKCD Survey</option>
        </optgroup>
        <optgroup label="Standards">
            <option value="html">HTML / CSS</option>
            <option value="basic">Basic (16)</option>
            <option value="ntc">Name That Color (Classic)</option>
            <option value="x11">X11</option>
            <option value="windows">MS Windows</option>
        </optgroup>
        Z<optgroup label="Cultural/Traditional">
            <!-- <option value="turkish_colors.csv">Türkçe (Wikipedia)</option>  -->
            <!-- <option value="turkce2.csv">Türkçe 2</option>  -->
            <option value="turkish_combined.csv">Türkçe Kombine</option> 
            <option value="japaneseTraditional">Japanese Traditional</option>
            <option value="chineseTraditional">Chinese Traditional</option>
            <option value="french">French Colors</option>
            <option value="spanish">Spanish Colors</option>
            <option value="german">German Colors</option>
        </optgroup>
        <optgroup label="Art & History">
            <option value="crayola">Crayola Crayons</option>
            <option value="osxcrayons">Apple Crayons</option>
            <option value="ral">RAL (Industrial)</option>
            <option value="sanzoWadaI">Sanzo Wada (Art)</option>
            <option value="werner">Werner’s (Darwin-era)</option>
            <option value="ridgway">Ridgway’s (Birds)</option>
            <option value="leCorbusier">Le Corbusier</option>
        </optgroup>
    </select>
    <span id="colorCount" style="font-size: 11px; color: #666; margin-left: 5px; padding-left: 7px; border-left: 1px solid #333; min-width: 30px;">0</span>
`;

// The function to inject the dropdown into a page and set it up
export function setupDictionarySelector(containerId, onColorsLoadedCallback) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 1. Inject the HTML
    container.innerHTML = dropdownHTML;

    // 2. See what list we used last time (default to 30k list)
    const savedList = localStorage.getItem('colordle_list') || 'colornames.csv';
    document.getElementById('dictionarySelect').value = savedList;

    // 3. Listen for changes
    document.getElementById('dictionarySelect').addEventListener('change', async (e) => {
        const newList = e.target.value;
        localStorage.setItem('colordle_list', newList);
        await loadColors(newList);
        // Tell the page that new colors are ready (e.g., redraw 3D dots)
        if (onColorsLoadedCallback) onColorsLoadedCallback(); 
    });

    // 4. Load the initial colors
    return loadColors(savedList).then(() => {
        if (onColorsLoadedCallback) onColorsLoadedCallback();
    });
}

// The core fetching logic
async function loadColors(listName) {
    ALL_COLORS = [];
    try {
        if (listName.endsWith('.csv')) {
            // Reverting to your original, reliable logic
            const resp = await fetch(listName);
            const text = await resp.text();
            const lines = text.split('\n');
            
            for(let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if(line) {
                    // Simple split by comma - preserves spaces in names!
                    const parts = line.split(','); 
                    if(parts.length >= 2) {
                        ALL_COLORS.push({
                            // Trim removes extra whitespace but keeps spaces between words
                            name: parts[0].trim().replace(/"/g, ''), 
                            hex: parts[1].trim(),
                            isGood: parts[2] && parts[2].trim().toLowerCase() === 'x'
                        });
                    }
                }
            }
        } else {
            // Logic for the internet API
            const resp = await fetch(`https://api.color.pizza/v1/?list=${listName}`);
            const d = await resp.json();
            ALL_COLORS = d.colors.map(c => ({ 
                name: c.name, 
                hex: c.hex, 
                isGood: true 
            }));
        }

        // Update the counter
        const countEl = document.getElementById('colorCount');
        if(countEl) countEl.innerText = ALL_COLORS.length.toLocaleString();
        
    } catch (err) { 
        console.error("Error loading colors:", err); 
    }
}