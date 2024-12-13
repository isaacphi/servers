import { google } from "googleapis";
import { Tool, GDriveSearchInput, InternalToolResponse } from "./types.js";

export const schema = {
  name: "gdrive_search",
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
} as const;

export async function search(args: GDriveSearchInput): Promise<InternalToolResponse> {
  const drive = google.drive("v3");
  const userQuery = args.query;
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
}