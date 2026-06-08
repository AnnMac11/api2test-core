/**
 * Shared API Library DTO
 * Mirrors the C# ApiLibraryDto from the backend
 */
export interface ApiLibraryDto {
  id: string;
  name: string;
  fileName: string;
  application: string;
  method: string;
  path: string;
  url: string;
  description?: string;
  importDate: string;
  source: string;
  hasExampleData: boolean;
  requestHeaders?: string;
  requestBodyTemplate?: string;
  responseExamples?: string;
  contentType?: string;
}


