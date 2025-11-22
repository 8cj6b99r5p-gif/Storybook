
// Service to handle Google Drive Authentication and Uploads

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

export const initGoogleDrive = async (clientId: string, apiKey?: string): Promise<boolean> => {
  if (!clientId) return false;

  return new Promise((resolve) => {
    const gapiLoaded = () => {
      window.gapi.load('client', async () => {
        await window.gapi.client.init({
          apiKey: apiKey || '',
          discoveryDocs: [DISCOVERY_DOC],
        });
        gapiInited = true;
        checkAuth();
      });
    };

    const gisLoaded = () => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: '', // defined later
      });
      gisInited = true;
      checkAuth();
    };

    const checkAuth = () => {
      if (gapiInited && gisInited) {
        resolve(true);
      }
    };

    // Check if scripts are already loaded
    if (window.gapi) gapiLoaded();
    if (window.google) gisLoaded();
  });
};

export const connectToDrive = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject("Google Drive not initialized");

    tokenClient.callback = async (resp: any) => {
      if (resp.error !== undefined) {
        reject(resp);
      }
      resolve();
    };

    // Request an access token
    if (window.gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  });
};

export const isSignedIn = (): boolean => {
  return window.gapi && window.gapi.client && window.gapi.client.getToken() !== null;
};

export const uploadFileToDrive = async (blob: Blob, filename: string, mimeType: string, folderName = "DreamWeaver Stories"): Promise<string> => {
  if (!isSignedIn()) throw new Error("Not signed in to Google Drive");

  try {
    // 1. Find or Create Folder
    let folderId = '';
    const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`;
    const folderResponse = await window.gapi.client.drive.files.list({ q, fields: 'files(id, name)' });
    
    if (folderResponse.result.files && folderResponse.result.files.length > 0) {
      folderId = folderResponse.result.files[0].id;
    } else {
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      };
      const createFolderResponse = await window.gapi.client.drive.files.create({
        resource: folderMetadata,
        fields: 'id',
      });
      folderId = createFolderResponse.result.id;
    }

    // 2. Upload File
    const metadata = {
      name: filename,
      mimeType: mimeType,
      parents: [folderId],
    };

    const accessToken = window.gapi.client.getToken().access_token;
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const uploadResponse = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
      method: 'POST',
      headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
      body: form,
    });

    const data = await uploadResponse.json();
    return data.id; // Return File ID

  } catch (error) {
    console.error("Drive Upload Error", error);
    throw error;
  }
};
