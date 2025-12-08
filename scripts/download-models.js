const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_URL = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
const MODELS_DIR = path.join(__dirname, '../models');

const files = [
    'ssd_mobilenetv1_model-weights_manifest.json',
    'ssd_mobilenetv1_model-shard1'
];

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`Downloaded: ${path.basename(dest)}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function downloadModels() {
    console.log('Downloading face-api models...');
    
    if (!fs.existsSync(MODELS_DIR)) {
        fs.mkdirSync(MODELS_DIR, { recursive: true });
    }

    for (const file of files) {
        const url = MODEL_URL + file;
        const dest = path.join(MODELS_DIR, file);
        
        try {
            await downloadFile(url, dest);
        } catch (error) {
            console.error(`Failed to download ${file}:`, error);
        }
    }

    console.log('Models downloaded successfully!');
}

downloadModels().catch(console.error);
