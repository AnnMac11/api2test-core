/**
 * Global C# generation utility for API Methods
 * Generates complete ApiMethods.cs file with all methods from the API Method Library
 */

export interface ApiMethodForGeneration {
  id: string;
  methodName: string;
  description: string;
  parameters: string;
  returnType: string;
  code: string;
  category: string;
  application: string;
  isCustom: boolean;
}

export interface CSharpGenerationOptions {
  namespace?: string;
  className?: string;
  includeUsingStatements?: boolean;
  includeApiClient?: boolean;
}

/**
 * Generates complete C# ApiMethods class
 */
export function generateApiMethodsCSharp(
  methods: ApiMethodForGeneration[],
  options: CSharpGenerationOptions = {}
): string {
  const {
    namespace = 'Api2Test.Libraries',
    className = 'ApiMethods',
    includeUsingStatements = true,
    includeApiClient = true
  } = options;

  // Filter methods that contain "token" in the name for authentication
  const tokenMethods = methods.filter(method => 
    method.methodName.toLowerCase().includes('token')
  );

  // Filter other methods (HTTP methods, utilities, etc.)
  const otherMethods = methods.filter(method => 
    !method.methodName.toLowerCase().includes('token')
  );

  let csharpCode = '';

  // Add using statements
  if (includeUsingStatements) {
    csharpCode += `using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;
using Newtonsoft.Json;

`;
  }

  // Add namespace
  csharpCode += `namespace ${namespace}
{
    public static class ${className}
    {
        // Shared client for the token-based helpers (those that don't open their own \`using\` client).
        private static readonly HttpClient _httpClient = new HttpClient();

`;

  // Add ApiClient base methods if requested
  if (includeApiClient) {
    csharpCode += `        // Base HTTP client methods
        public static async Task<HttpResponseMessage> PostWithTokenAsync(
            string url, 
            string authToken, 
            object jsonBody)
        {
            using (var httpClient = new HttpClient())
            {
                // Set headers
                httpClient.DefaultRequestHeaders.Accept.Clear();
                httpClient.DefaultRequestHeaders.Accept.Add(
                    new MediaTypeWithQualityHeaderValue("application/json"));
                
                if (!string.IsNullOrEmpty(authToken))
                {
                    httpClient.DefaultRequestHeaders.Authorization = 
                        new AuthenticationHeaderValue("Bearer", authToken);
                }

                // Serialize the body to JSON
                string jsonContent = JsonConvert.SerializeObject(jsonBody);
                var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

                // Make the POST request and return the response
                return Reporter.Record(await httpClient.PostAsync(url, content));
            }
        }

        public static async Task<HttpResponseMessage> GetWithTokenAsync(
            string url, 
            string authToken)
        {
            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Accept.Clear();
                httpClient.DefaultRequestHeaders.Accept.Add(
                    new MediaTypeWithQualityHeaderValue("application/json"));
                
                if (!string.IsNullOrEmpty(authToken))
                {
                    httpClient.DefaultRequestHeaders.Authorization = 
                        new AuthenticationHeaderValue("Bearer", authToken);
                }

                return Reporter.Record(await httpClient.GetAsync(url));
            }
        }

        public static async Task<HttpResponseMessage> PutWithTokenAsync(
            string url, 
            string authToken, 
            object jsonBody)
        {
            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Accept.Clear();
                httpClient.DefaultRequestHeaders.Accept.Add(
                    new MediaTypeWithQualityHeaderValue("application/json"));
                
                if (!string.IsNullOrEmpty(authToken))
                {
                    httpClient.DefaultRequestHeaders.Authorization = 
                        new AuthenticationHeaderValue("Bearer", authToken);
                }

                string jsonContent = JsonConvert.SerializeObject(jsonBody);
                var content = new StringContent(jsonContent, Encoding.UTF8, "application/json");

                return Reporter.Record(await httpClient.PutAsync(url, content));
            }
        }

        public static async Task<HttpResponseMessage> DeleteWithTokenAsync(
            string url, 
            string authToken)
        {
            using (var httpClient = new HttpClient())
            {
                httpClient.DefaultRequestHeaders.Accept.Clear();
                httpClient.DefaultRequestHeaders.Accept.Add(
                    new MediaTypeWithQualityHeaderValue("application/json"));
                
                if (!string.IsNullOrEmpty(authToken))
                {
                    httpClient.DefaultRequestHeaders.Authorization = 
                        new AuthenticationHeaderValue("Bearer", authToken);
                }

                return Reporter.Record(await httpClient.DeleteAsync(url));
            }
        }

        // Helper method to read response content
        public static async Task<T> GetResponseContentAsync<T>(HttpResponseMessage response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new HttpRequestException($"Request failed with status: {response.StatusCode}");
            }

            string content = await response.Content.ReadAsStringAsync();
            return JsonConvert.DeserializeObject<T>(content);
        }

`;
  }

  // Add token/authentication methods
  if (tokenMethods.length > 0) {
    csharpCode += `        // Authentication and Token Methods
`;
    tokenMethods.forEach(method => {
      csharpCode += generateMethodFromCode(method, '        ');
    });
    csharpCode += '\n';
  }

  // Add other methods
  if (otherMethods.length > 0) {
    csharpCode += `        // Additional API Methods
`;
    otherMethods.forEach(method => {
      csharpCode += generateMethodFromCode(method, '        ');
    });
  }

  // Close the ApiMethods class, emit the Reporter, then close the namespace.
  csharpCode += `    }

    /// <summary>
    /// Captures each API call (request + response) so the local/CI runner can extract it from the test's
    /// console output. Every HTTP method reports by default via Reporter.Record(response).
    /// </summary>
    public static class Reporter
    {
        private const int MaxBody = 16384;

        /// <summary>Record one call and return the response unchanged. Reads the request off
        /// HttpResponseMessage.RequestMessage, so a single argument carries both sides. Never throws.</summary>
        public static HttpResponseMessage Record(HttpResponseMessage response)
        {
            try
            {
                var req = response?.RequestMessage;
                var call = new
                {
                    method = req?.Method?.Method,
                    url = req?.RequestUri?.ToString(),
                    requestBody = Read(req?.Content),
                    status = response == null ? 0 : (int)response.StatusCode,
                    responseBody = Read(response?.Content),
                };
                Console.WriteLine("##A2T_CALL## " + System.Text.Json.JsonSerializer.Serialize(call));
            }
            catch { /* reporting must never fail a test */ }
            return response;
        }

        private static string Read(HttpContent content)
        {
            if (content == null) return null;
            try
            {
                var s = content.ReadAsStringAsync().GetAwaiter().GetResult();
                return s != null && s.Length > MaxBody ? s.Substring(0, MaxBody) + "\\u2026(truncated)" : s;
            }
            catch { return null; }
        }
    }
}
`;

  return csharpCode;
}

/**
 * Generates a single C# method from API method data
 */
function generateMethodFromCode(method: ApiMethodForGeneration, indent: string): string {
  let methodCode = '';

  // Add method documentation
  if (method.description) {
    methodCode += `${indent}/// <summary>
${indent}/// ${method.description}
${indent}/// </summary>
`;
  }

  // Add parameters documentation
  if (method.parameters) {
    methodCode += `${indent}/// <param name="parameters">${method.parameters}</param>
`;
  }

  // Use the provided code if available, otherwise generate a basic method
  if (method.code && method.code.trim()) {
    // Use the provided code, but ensure proper indentation
    const indentedCode = method.code
      .split('\n')
      .map(line => line.trim() ? `${indent}${line}` : line)
      .join('\n');
    methodCode += `${indent}${indentedCode}\n\n`;
  } else {
    // Generate a basic method signature
    const returnType = method.returnType || 'void';
    const parameters = method.parameters || '';
    
    methodCode += `${indent}public static ${returnType} ${method.methodName}(${parameters})
${indent}{
${indent}    // TODO: Implement ${method.methodName}
${indent}    throw new NotImplementedException();
${indent}}

`;
  }

  return methodCode;
}

/**
 * Filters methods by token-related names for authentication dropdown
 */
export function getTokenMethods(methods: ApiMethodForGeneration[]): ApiMethodForGeneration[] {
  return methods.filter(method => 
    method.methodName.toLowerCase().includes('token') ||
    method.methodName.toLowerCase().includes('auth') ||
    method.methodName.toLowerCase().includes('login') ||
    method.methodName.toLowerCase().includes('credential')
  );
}

/**
 * Gets method categories for organization
 */
export function getMethodCategories(methods: ApiMethodForGeneration[]): string[] {
  const categories = new Set<string>();
  methods.forEach(method => {
    if (method.category) {
      categories.add(method.category);
    }
  });
  return Array.from(categories).sort();
}
