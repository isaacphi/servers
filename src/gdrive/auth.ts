import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import fs from "fs";
import path from "path";

export const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

const credentialsPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../.gdrive-server-credentials.json",
);

async function authenticateAndSaveCredentials() {
  console.error("Launching auth flow…");

  const auth = await authenticate({
    keyfilePath: path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../gcp-oauth.keys.json",
    ),
    scopes: SCOPES,
  });

  const newAuth = new google.auth.OAuth2();
  newAuth.setCredentials(auth.credentials);

  try {
    const { credentials } = await auth.refreshAccessToken();
    console.error("Credentials", credentials);
    fs.writeFileSync(credentialsPath, JSON.stringify(credentials));
    console.error("Credentials saved with refresh token.");
    auth.setCredentials(credentials);
    return auth;
  } catch (error) {
    console.error("Error refreshing token:", error);
    return auth;
  }
}

export async function loadOrRefreshCredentials() {
  const oauth2Client = new google.auth.OAuth2();

  if (!fs.existsSync(credentialsPath)) {
    return await authenticateAndSaveCredentials();
  }

  try {
    const savedCreds = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
    oauth2Client.setCredentials(savedCreds);

    const expiryDate = new Date(savedCreds.expiry_date);
    const now = new Date();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiryDate.getTime() - now.getTime() < fiveMinutes) {
      console.error("Token needs refresh...");
      if (savedCreds.refresh_token) {
        const response = await oauth2Client.refreshAccessToken();
        const newCreds = response.credentials;
        fs.writeFileSync(credentialsPath, JSON.stringify(newCreds));
        oauth2Client.setCredentials(newCreds);
        console.error("Token refreshed successfully");
      } else {
        console.error("No refresh token, launching new auth flow...");
        return await authenticateAndSaveCredentials();
      }
    }

    return oauth2Client;
  } catch (error) {
    console.error("Error loading/refreshing credentials:", error);
    return await authenticateAndSaveCredentials();
  }
}

export function setupTokenRefresh() {
  return setInterval(
    async () => {
      try {
        const auth = await loadOrRefreshCredentials();
        google.options({ auth });
        console.error("Refreshed credentials automatically");
      } catch (error) {
        console.error("Error in automatic token refresh:", error);
      }
    },
    45 * 60 * 1000,
  );
}