import { librariesNs } from './generatedNamespaces';

/** Minimal shape needed to emit a data method (full C# method in `code`). */
export interface DataMethodCode {
  methodName: string;
  description?: string;
  /** The complete C# method (signature + body), instance-style, may reference `_faker`. */
  code?: string;
}

/**
 * Generates the Data Library C# file as a single instance class `DataGenerator` holding a Bogus
 * `_faker`. The request classes reference it as `new DataGenerator().Method()`, so it must be an
 * instance class with the same name. Each method's `code` is a complete instance method — it is
 * pasted as-is (NOT re-wrapped in another signature).
 */
export function generateDataLibraryCode(methods: DataMethodCode[], root?: string): string {
  const indent = (text: string) => text.split('\n').map(l => (l.length ? '        ' + l : l)).join('\n');

  const body = (methods || []).map(m => {
    const code = (m.code || `public object ${m.methodName}() => throw new System.NotImplementedException();`).trim();
    const doc = m.description ? `        /// <summary>${m.description.replace(/\n/g, ' ')}</summary>\n` : '';
    return doc + indent(code);
  }).join('\n\n');

  return `using System;
using System.Collections.Generic;
using System.Linq;
using Bogus;

namespace ${librariesNs(root)}
{
    /// <summary>Generates field values for test data (the Data Library). Request classes call
    /// it as <c>new DataGenerator().Method()</c>.</summary>
    public class DataGenerator
    {
        private readonly Faker _faker = new Faker();
        private readonly Random _random = new Random();

${body}
    }
}
`;
}
