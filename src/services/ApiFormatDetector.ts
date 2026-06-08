import { ApiFormat } from '../models/UnifiedApiDto';

export class ApiFormatDetector {
    
    detect(content: string, fileName?: string): ApiFormat {
        // Check file extension first
        if (fileName) {
            const ext = fileName.split('.').pop()?.toLowerCase();
            if (ext === 'yaml' || ext === 'yml') {
                // Check content to distinguish OpenAPI YAML from RAML YAML
                if (content.includes('openapi:') || content.includes('swagger:')) {
                    return 'openapi';
                }
                return 'raml';
            }
            if (ext === 'raml') {
                return 'raml';
            }
            if (ext === 'graphql' || ext === 'gql') {
                return 'graphql';
            }
        }
        
        // For JSON files, check content structure
        try {
            const data = JSON.parse(content);
            
            // Postman: has info.name and item array
            if (data.info?.name && data.item) {
                return 'postman';
            }
            
            // Insomnia: has __export_format and resources
            if (data.__export_format && data.resources) {
                return 'insomnia';
            }
            
            // OpenAPI: has openapi or swagger field
            if (data.openapi || data.swagger) {
                return 'openapi';
            }
            
            // GraphQL: has __schema (introspection result)
            if (data.__schema) {
                return 'graphql';
            }
            
        } catch {
            // Not JSON - check if it's YAML (RAML) or GraphQL SDL
            if (content.includes('type Query') || content.includes('type Mutation')) {
                return 'graphql';
            }
            if (content.includes('#%RAML') || content.match(/^title:/m)) {
                return 'raml';
            }
        }
        
        return 'unknown';
    }
}

