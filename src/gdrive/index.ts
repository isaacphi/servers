#!/usr/bin/env node

import { authenticate } from "@google-cloud/local-auth";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { google } from "googleapis";
import path from "path";

const drive = google.drive("v3");

const server = new Server(
  {
    name: "example-servers/gdrive",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  const pageSize = 10;
  const params: any = {
    pageSize,
    fields: "nextPageToken, files(id, name, mimeType)",
  };

  if (request.params?.cursor) {
    params.pageToken = request.params.cursor;
  }

  const res = await drive.files.list(params);
  const files = res.data.files!;

  return {
    resources: files.map((file) => ({
      uri: `gdrive:///${file.id}`,
      mimeType: file.mimeType,
      name: file.name,
    })),
    nextCursor: res.data.nextPageToken,
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const fileId = request.params.uri.replace("gdrive:///", "");

  // First get file metadata to check mime type
  const file = await drive.files.get({
    fileId,
    fields: "mimeType",
  });

  // For Google Docs/Sheets/etc we need to export
  if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
    let exportMimeType: string;
    switch (file.data.mimeType) {
      case "application/vnd.google-apps.document":
        exportMimeType = "text/markdown";
        break;
      case "application/vnd.google-apps.spreadsheet":
        exportMimeType = "text/csv";
        break;
      case "application/vnd.google-apps.presentation":
        exportMimeType = "text/plain";
        break;
      case "application/vnd.google-apps.drawing":
        exportMimeType = "image/png";
        break;
      default:
        exportMimeType = "text/plain";
    }

    const res = await drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "text" },
    );

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: exportMimeType,
          text: res.data,
        },
      ],
    };
  }

  // For regular files download content
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  const mimeType = file.data.mimeType || "application/octet-stream";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: mimeType,
          text: Buffer.from(res.data as ArrayBuffer).toString("utf-8"),
        },
      ],
    };
  } else {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: mimeType,
          blob: Buffer.from(res.data as ArrayBuffer).toString("base64"),
        },
      ],
    };
  }
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search",
        description: "Search for files in Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "read_google_drive_file",
        description: "Read contents of a file from Google Drive",
        inputSchema: {
          type: "object",
          properties: {
            fileId: {
              type: "string",
              description: "ID of the file to read",
            },
          },
          required: ["fileId"],
        },
      },
      {
        name: "update_cell",
        description: "Update a cell value in a Google Spreadsheet",
        inputSchema: {
          type: "object",
          properties: {
            fileId: {
              type: "string",
              description: "ID of the spreadsheet",
            },
            range: {
              type: "string",
              description: "Cell range in A1 notation (e.g. 'Sheet1!A1')",
            },
            value: {
              type: "string",
              description: "New cell value",
            },
          },
          required: ["fileId", "range", "value"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "search") {
    const userQuery = request.params.arguments?.query as string;
    const escapedQuery = userQuery.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const formattedQuery = `fullText contains '${escapedQuery}'`;

    const res = await drive.files.list({
      q: formattedQuery,
      pageSize: 10,
      fields: "files(id, name, mimeType, modifiedTime, size)",
    });

    const fileList = res.data.files
      ?.map((file: any) => `${file.id} ${file.name} (${file.mimeType})`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Found ${res.data.files?.length ?? 0} files:\n${fileList}`,
        },
      ],
      isError: false,
    };
  } else if (request.params.name === "read_google_drive_file") {
    const fileId = request.params.arguments?.fileId as string;

    // First get file metadata to check mime type
    const file = await drive.files.get({
      fileId,
      fields: "mimeType,name",
    });

    // For Google Docs/Sheets/etc we need to export
    if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
      let exportMimeType: string;
      switch (file.data.mimeType) {
        case "application/vnd.google-apps.document":
          exportMimeType = "text/markdown";
          break;
        case "application/vnd.google-apps.spreadsheet":
          exportMimeType = "text/csv";
          break;
        case "application/vnd.google-apps.presentation":
          exportMimeType = "text/plain";
          break;
        case "application/vnd.google-apps.drawing":
          exportMimeType = "image/png";
          break;
        default:
          exportMimeType = "text/plain";
      }

      const res = await drive.files.export(
        { fileId, mimeType: exportMimeType },
        { responseType: "text" },
      );

      return {
        content: [
          {
            type: "text",
            text: `Contents of ${file.data.name}:\n\n${res.data}`,
          },
        ],
        isError: false,
      };
    }

    // For regular files download content
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    const mimeType = file.data.mimeType || "application/octet-stream";
    let content;
    if (mimeType.startsWith("text/") || mimeType === "application/json") {
      content = Buffer.from(res.data as ArrayBuffer).toString("utf-8");
    } else {
      content = Buffer.from(res.data as ArrayBuffer).toString("base64");
    }

    return {
      content: [
        {
          type: "text",
          text: `Contents of ${file.data.name}:\n\n${content}`,
        },
      ],
      isError: false,
    };
  } else if (request.params.name === "update_cell") {
    const fileId = request.params.arguments?.fileId as string;
    const range = request.params.arguments?.range as string;
    const value = request.params.arguments?.value as string;

    const sheets = google.sheets({ version: "v4" });

    await sheets.spreadsheets.values.update({
      spreadsheetId: fileId,
      range: range,
      valueInputOption: "RAW",
      requestBody: {
        values: [[value]],
      },
    });

    return {
      content: [
        {
          type: "text",
          text: `Updated cell ${range} to value: ${value}`,
        },
      ],
      isError: false,
    };
  }
  throw new Error("Tool not found");
});

const credentialsPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../.gdrive-server-credentials.json",
);

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
];

async function authenticateAndSaveCredentials() {
  console.error("Launching auth flow…");

  // Use the base authenticate function but modify how we handle the credentials
  const auth = await authenticate({
    keyfilePath: path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../../../gcp-oauth.keys.json",
    ),
    scopes: SCOPES,
  });

  // Force the client to refresh the token to get a new one with offline access
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

async function loadOrRefreshCredentials() {
  const oauth2Client = new google.auth.OAuth2();

  if (!fs.existsSync(credentialsPath)) {
    return await authenticateAndSaveCredentials();
  }

  try {
    const savedCreds = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));
    oauth2Client.setCredentials(savedCreds);

    // Check if we need to refresh
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

async function startServer() {
  try {
    const auth = await loadOrRefreshCredentials();
    google.options({ auth });

    console.log("Starting server with authenticated client");
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Set up periodic token refresh
    setInterval(
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
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

// Start server immediately
startServer().catch(console.error);

