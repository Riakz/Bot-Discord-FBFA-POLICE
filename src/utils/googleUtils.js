import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CREDENTIALS_PATH = path.join(__dirname, '../../credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'];

let authClient = null;

async function getAuthClient() {
    if (authClient) return authClient;
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        throw new Error('Le fichier credentials.json est manquant à la racine du bot.');
    }
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: SCOPES,
    });
    authClient = await auth.getClient();
    return authClient;
}

export function parseSheetUrl(url) {
    const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) return null;
    const gidMatch = url.match(/[#&]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    return { spreadsheetId: idMatch[1], gid: gid };
}

async function cleanDriveSpace(drive) {
    console.log('[MAINTENANCE] Starting aggressive Drive cleanup...');
    try {
        const about = await drive.about.get({ fields: 'storageQuota' });
        const quota = about.data.storageQuota;
        if (quota) {
            console.log(`[MAINTENANCE] Quota Usage: ${(quota.usage / 1024 / 1024).toFixed(2)} MB`);
        }

        try { await drive.files.emptyTrash(); } catch (e) { }

        let pageToken = null;
        do {
            const res = await drive.files.list({
                q: "'me' in owners",
                fields: 'nextPageToken, files(id, name)',
                spaces: 'drive',
                pageSize: 100,
                pageToken: pageToken
            });
            const files = res.data.files;
            if (files && files.length > 0) {
                for (const file of files) {
                    try { await drive.files.delete({ fileId: file.id }); } catch (e) { }
                }
            }
            pageToken = res.data.nextPageToken;
        } while (pageToken);
    } catch (error) {
        console.error('[MAINTENANCE ERROR]', error);
    }
}

async function runCopyExport(drive, spreadsheetId) {
    let tempFileId = null;
    try {
        console.log(`[STRATEGY A] Cloning Sheet ${spreadsheetId}...`);
        const copyResponse = await drive.files.copy({
            fileId: spreadsheetId,
            requestBody: { name: `TEMP_EXPORT_${Date.now()}` }
        });
        tempFileId = copyResponse.data.id;

        console.log(`[STRATEGY A] Exporting copy via API...`);
        const exportResponse = await drive.files.export({
            fileId: tempFileId,
            mimeType: 'application/pdf'
        }, { responseType: 'arraybuffer' });

        return Buffer.from(exportResponse.data);
    } finally {
        if (tempFileId) {
            try { await drive.files.delete({ fileId: tempFileId }); } catch (e) { }
        }
    }
}

async function runDirectUrlExport(client, spreadsheetId, gid, range, overrideSheetName = null) {
    console.log(`[STRATEGY B] Fallback to Direct URL Export...`);

    const service = google.sheets({ version: 'v4', auth: client });
    const meta = await service.spreadsheets.get({ spreadsheetId });

    let targetSheet;

    if (overrideSheetName) {
        console.log(`[STRATEGY B] Using Explicit Sheet Name: '${overrideSheetName}'`);
        targetSheet = meta.data.sheets.find(s => s.properties.title.trim().toLowerCase() === overrideSheetName.trim().toLowerCase());
        if (!targetSheet) console.warn(`[STRATEGY B] Explicit sheet '${overrideSheetName}' not found. Falling back...`);
    }

    if (!targetSheet) {
        targetSheet = meta.data.sheets.find(s => s.properties.sheetId == gid);
    }

    if (!targetSheet || targetSheet.properties.hidden) {
        console.warn(`[DEBUG] GID ${gid} invalid/hidden/not-found. Searching for 'Formulaire 1'...`);
        targetSheet = meta.data.sheets.find(s => s.properties.title.trim().toLowerCase() === "formulaire 1" && !s.properties.hidden);
    }

    if (!targetSheet || targetSheet.properties.hidden) {
        console.warn(`[DEBUG] 'Formulaire 1' not found/hidden. Switching to first VISIBLE sheet.`);
        targetSheet = meta.data.sheets.find(s => !s.properties.hidden);
    }

    if (!targetSheet) throw new Error("Aucune feuille visible trouvée.");

    const finalGid = targetSheet.properties.sheetId;
    const accessTokenResponse = await client.getAccessToken();
    const accessToken = accessTokenResponse.token || accessTokenResponse;

    const params = new URLSearchParams({
        format: 'pdf', size: 'A4', portrait: 'false', fitw: 'true',
        gridlines: 'false', printtitle: 'false', sheetnames: 'false', pagenum: 'false',
        gid: finalGid, range: range,
        top_margin: '0', bottom_margin: '0', left_margin: '0', right_margin: '0',
        timestamp: Date.now()
    });

    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${params.toString()}`;
    const response = await fetch(exportUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) throw new Error(`Direct Export Failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

export async function exportSheetToPdf(spreadsheetId, gid, range = "B2:R26", overrideSheetName = null) {
    const client = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth: client });

    try {
        if (!overrideSheetName) {
            return await runCopyExport(drive, spreadsheetId);
        } else {
            console.log('[GoogleUtils] Override Name present, skipping Copy Strategy to ensure correct sheet targeting via URL.');
            throw new Error("Skipping Strategy A for explicit sheet targeting");
        }
    } catch (error) {
        if (error.message && (error.message.includes('quota') || error.code === 403)) {
            console.warn('[QUOTA ERROR] Cleaning Drive and Retrying...');
            await cleanDriveSpace(drive);
            try {
                if (!overrideSheetName) return await runCopyExport(drive, spreadsheetId);
            } catch (retryError) {
                console.warn('[STRATEGY A FAILED] Switching to Strategy B...');
            }
        } else {
            console.warn(`[STRATEGY A ERROR] ${error.message}. Switching to Strategy B...`);
        }
        return await runDirectUrlExport(client, spreadsheetId, gid, range, overrideSheetName);
    }
}

export async function convertPdfToImage(pdfBuffer) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    const pdfBase64 = pdfBuffer.toString('base64');

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>body { margin: 0; overflow: hidden; background: white; }</style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        <script>pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';</script>
    </head>
    <body>
        <canvas id="the-canvas"></canvas>
        <script>
            async function render() {
                try {
                    const pdfData = atob("${pdfBase64}");
                    const loadingTask = pdfjsLib.getDocument({data: pdfData});
                    const pdf = await loadingTask.promise;

                    const page = await pdf.getPage(1);
                    const scale = 2.0;
                    const viewport = page.getViewport({scale: scale});

                    const canvas = document.getElementById('the-canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                        background: 'rgba(255, 255, 255, 0)'
                    };
                    await page.render(renderContext).promise;

                    const w = canvas.width;
                    const h = canvas.height;
                    const imgData = context.getImageData(0, 0, w, h);
                    const data = imgData.data;

                    let minX = w, minY = h, maxX = 0, maxY = 0;
                    let found = false;

                    for (let y = 0; y < h; y++) {
                        for (let x = 0; x < w; x++) {
                            const idx = (y * w + x) * 4;
                            const r = data[idx];
                            const g = data[idx+1];
                            const b = data[idx+2];
                            const a = data[idx+3];

                            if (a > 50 && (r < 240 || g < 240 || b < 240)) {
                                if (x < minX) minX = x;
                                if (x > maxX) maxX = x;
                                if (y < minY) minY = y;
                                if (y > maxY) maxY = y;
                                found = true;
                            }
                        }
                    }

                    if (!found) return null;

                    const padding = 0;
                    minX = Math.max(0, minX - padding);
                    minY = Math.max(0, minY - padding);
                    maxX = Math.min(w, maxX + padding);
                    maxY = Math.min(h, maxY + padding);

                    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
                } catch (e) {
                    console.error(e);
                    return null;
                }
            }
        </script>
    </body>
    </html>
    `;

    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const cropBox = await page.evaluate(async () => {
        return await window.render();
    });

    if (!cropBox) {
        const screenshot = await page.screenshot({ omitBackground: true });
        await browser.close();
        return screenshot;
    }

    const imageBuffer = await page.screenshot({
        clip: cropBox,
        omitBackground: true
    });

    await browser.close();
    return imageBuffer;
}

export async function fetchSheetValues(spreadsheetId, gid, ranges, overrideSheetName = null) {
    const auth = await getAuthClient();
    const service = google.sheets({ version: 'v4', auth });

    const meta = await service.spreadsheets.get({ spreadsheetId });
    let sheet;

    if (overrideSheetName) {
        console.log(`[GoogleUtils] fetchSheetValues: Using Explicit Sheet Name: '${overrideSheetName}'`);
        sheet = meta.data.sheets.find(s => s.properties.title.trim().toLowerCase() === overrideSheetName.trim().toLowerCase());
        if (!sheet) console.warn(`[GoogleUtils] Warning: Explicit sheet '${overrideSheetName}' not found. Falling back...`);
    }

    if (!sheet) {
        sheet = meta.data.sheets.find(s => s.properties.sheetId == gid);
    }

    if (!sheet || sheet.properties.hidden) {
        console.log(`[GoogleUtils] fetchSheetValues: GID ${gid} not found/hidden. Searching for 'Formulaire 1'...`);
        sheet = meta.data.sheets.find(s => s.properties.title.trim().toLowerCase() === "formulaire 1" && !s.properties.hidden);
    }

    if (sheet) console.log(`[GoogleUtils] Resolved Sheet for Text Data: '${sheet.properties.title}' (GID: ${sheet.properties.sheetId})`);

    if (!sheet) {
        console.log(`[GoogleUtils] fetchSheetValues: 'Formulaire 1' not found. Using first visible sheet.`);
        sheet = meta.data.sheets.find(s => !s.properties.hidden);
    }

    const sheetName = sheet ? sheet.properties.title : meta.data.sheets[0].properties.title;
    const qualifiedRanges = ranges.map(r => `'${sheetName}'!${r}`);

    const response = await service.spreadsheets.values.batchGet({ spreadsheetId, ranges: qualifiedRanges });
    const values = response.data.valueRanges.map(vr => {
        if (!vr.values || vr.values.length === 0) return "";
        return vr.values.flat().filter(v => v).join(" ");
    });

    return { values, sheetName };
}
