import { google } from 'googleapis';
import fetch from 'node-fetch';
import { Readable } from 'stream';
import dotenv from 'dotenv';
dotenv.config();

export async function uploadImagesToDrive(urls) {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });
    const links = [];
    
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    if (!folderId) {
        console.error('GOOGLE_DRIVE_FOLDER_ID is missing in .env');
        return 'ОШИБКА: Папка на Google Drive не настроена';
    }
    
    for (let i = 0; i < urls.length; i++) {
        try {
            const response = await fetch(urls[i]);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const stream = new Readable();
            stream.push(buffer);
            stream.push(null);
            
            const file = await drive.files.create({
                requestBody: {
                    name: `screenshot_${Date.now()}_${i}.jpg`,
                    parents: [folderId] // Upload specifically to this shared folder
                },
                media: {
                    mimeType: 'image/jpeg',
                    body: stream
                },
                fields: 'id, webViewLink'
            });
            
            // Note: If the folder is shared with the organization, we might not need to manually change permissions per file
            // But doing it anyway to ensure it's viewable by anyone with the link
            await drive.permissions.create({
                fileId: file.data.id,
                requestBody: {
                    role: 'reader',
                    type: 'anyone',
                }
            });
            
            links.push(file.data.webViewLink);
        } catch (e) {
            console.error('Error uploading image to drive:', e);
            links.push('Error uploading image');
        }
    }
    return links.join('\n');
}
