// Define base types for our tool system
export interface Tool<T> {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: readonly string[];
  };
  handler: (args: T) => Promise<InternalToolResponse>;
}

// Our internal tool response format
export interface InternalToolResponse {
  content: {
    type: string;
    text: string;
  }[];
  isError: boolean;
}

// Input types for each tool
export interface GDriveSearchInput {
  query: string;
}

export interface GDriveReadFileInput {
  fileId: string;
}

export interface GSheetsUpdateCellInput {
  fileId: string;
  range: string;
  value: string;
}