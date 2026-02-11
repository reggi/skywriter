/* Custom Markdown Mode with EJS/Eta Template Support */

interface AceModeExports {
  Mode: new () => AceMode
}

interface AceMode {
  HighlightRules: new () => AceHighlightRules
  $id?: string
}

interface AceHighlightRules {
  $rules: Record<string, unknown[]>
}

interface AceOop {
  inherits(child: unknown, parent: unknown): void
}

interface AceRequire {
  (name: 'ace/lib/oop'): AceOop
  (name: 'ace/mode/text'): {Mode: new () => AceMode}
  (name: 'ace/mode/text_highlight_rules'): {TextHighlightRules: new () => AceHighlightRules}
  (name: string): unknown
}

interface AceGlobal {
  define(name: string, deps: string[], factory: (require: AceRequire, exports: AceModeExports) => void): void
}

export function aceMarkdown(ace: AceGlobal) {
  ace.define(
    'ace/mode/markdown_simple',
    [
      'require',
      'exports',
      'module',
      'ace/lib/oop',
      'ace/mode/text',
      'ace/mode/text_highlight_rules',
      'ace/mode/javascript_highlight_rules',
      'ace/mode/html_highlight_rules',
    ],
    function (require: AceRequire, exports: AceModeExports) {
      const oop = require('ace/lib/oop')
      const TextMode = require('ace/mode/text').Mode
      const TextHighlightRules = require('ace/mode/text_highlight_rules').TextHighlightRules

      const MarkdownSimpleHighlightRules = function (this: AceHighlightRules) {
        this.$rules = {
          start: [
            // Code blocks with language - enter codeblock state
            {
              token: 'support.function',
              regex: '^```javascript$',
              next: 'codeblock-js',
            },
            {
              token: 'support.function',
              regex: '^```js$',
              next: 'codeblock-js',
            },
            {
              token: 'support.function',
              regex: '^```\\w+$',
              next: 'codeblock',
            },
            {
              token: 'support.function',
              regex: '^```$',
              next: 'codeblock',
            },
            // Headings (before bold/italic to take precedence)
            {
              token: 'markup.heading',
              regex: /^#{1,6}\s+.*$/,
            },
            // EJS/Eta template tags with JS inside - match opening tag only
            {
              token: 'constant.language',
              regex: '<%[\\-=~]?',
              next: 'ejs',
            },
            // Bold **text** (non-greedy, must come before italic)
            {
              token: ['constant.numeric', 'markup.bold', 'constant.numeric'],
              regex: '(\\*\\*)([^*]+?)(\\*\\*)',
            },
            // Bold __text__
            {
              token: ['constant.numeric', 'markup.bold', 'constant.numeric'],
              regex: '(__)([^_]+?)(__)',
            },
            // Italic *text* (single star, not double)
            {
              token: ['constant.numeric', 'markup.italic', 'constant.numeric'],
              regex: '(\\*)([^*]+?)(\\*)',
            },
            // Italic _text_ (single underscore)
            {
              token: ['constant.numeric', 'markup.italic', 'constant.numeric'],
              regex: '(_)([^_]+?)(_)',
            },
            // Images: ![alt](url)
            {
              token: ['constant.numeric', 'string', 'constant.numeric', 'markup.underline.link', 'constant.numeric'],
              regex: '(\\!\\[)([^\\]]*)(\\]\\()([^)]+)(\\))',
            },
            // Links: [text](url)
            {
              token: ['constant.numeric', 'string', 'constant.numeric', 'markup.underline.link', 'constant.numeric'],
              regex: '(\\[)([^\\]]+)(\\]\\()([^)]+)(\\))',
            },
            // Inline code `code`
            {
              token: ['constant.numeric', 'string.quoted', 'constant.numeric'],
              regex: '(`)([^`]+)(`)',
            },
            // Lists - or *
            {
              token: 'keyword',
              regex: '^\\s*[\\-\\*]\\s',
            },
            // Lists numbered
            {
              token: 'keyword',
              regex: '^\\s*\\d+\\.\\s',
            },
            // Blockquote
            {
              token: 'markup.quote',
              regex: '^>.*$',
            },
            // Horizontal rule
            {
              token: 'constant',
              regex: '^(\\*\\*\\*|---|___)$',
            },
            // HTML tags with EJS support
            {
              token: 'meta.tag',
              regex: /<(?=[a-zA-Z])/,
              next: 'html-tag-open',
            },
            {
              token: 'meta.tag',
              regex: /<\/(?=[a-zA-Z])/,
              next: 'html-tag-close',
            },
          ],
          // Code block state
          codeblock: [
            {
              token: 'support.function',
              regex: '^```$',
              next: 'start',
            },
            {
              token: 'string.quoted',
              regex: '.+',
            },
            {
              defaultToken: 'string.quoted',
            },
          ],
          // JavaScript code block state with JS syntax
          'codeblock-js': [
            {
              token: 'support.function',
              regex: /^```$/,
              next: 'start',
            },
            {
              token: 'source.js',
              regex: /.+/,
            },
            {
              defaultToken: 'source.js',
            },
          ],
          // EJS state with JS syntax
          ejs: [
            {
              token: 'constant.language',
              regex: /%>/,
              next: 'start',
            },
            // Line // comments
            {
              token: 'comment.line.double-slash',
              regex: /\/\/.*$/,
            },
            // Block comment start
            {
              token: 'comment.start',
              regex: /\/\*/,
              next: 'ejs_comment',
            },
            // Strings
            {
              token: 'string.quoted.single',
              regex: /'(?:\\.|[^'])*'/,
            },
            {
              token: 'string.quoted.double',
              regex: /"(?:\\.|[^"])*"/,
            },
            // Template literal (no interpolation parsing here)
            {
              token: 'string.quoted.template',
              regex: /`(?:\\.|[^`])*`/,
            },
            // Numbers
            {
              token: 'constant.numeric',
              regex: /\b\d+(?:\.\d+)?\b/,
            },
            // Keywords
            {
              token: 'keyword',
              regex:
                /\b(?:if|else|for|while|function|return|let|const|var|new|switch|case|break|continue|in|of|try|catch|finally|throw|class|extends|super|import|from|export|default|this|await|async|yield)\b/,
            },
            // Boolean/null literals
            {
              token: 'constant.language',
              regex: /\b(?:true|false|null|undefined)\b/,
            },
            // Operators
            {
              token: 'keyword.operator',
              regex: /[+\-*\/%=!<>|&^~]+/,
            },
            // Punctuation
            {
              token: 'paren.lparen',
              regex: /[({\[]/,
            },
            {
              token: 'paren.rparen',
              regex: /[)}\]]/,
            },
            {
              token: 'punctuation.operator',
              regex: /[;,.:]/,
            },
            // Object method calls: .methodName(
            {
              token: ['punctuation.operator', 'entity.name.function'],
              regex: /(\.)([A-Za-z_$][A-Za-z0-9_$]*)(?=\s*\()/,
            },
            // Standalone function calls: identifier(
            {
              token: 'entity.name.function',
              regex:
                /\b(?!if|for|while|switch|catch|function|return|class|new|else|try|finally|throw|import|export|default|await|async|super|this)[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\()/,
            },
            // Identifiers
            {
              token: 'identifier',
              regex: /[A-Za-z_$][A-Za-z0-9_$]*/,
            },
            // Whitespace
            {
              token: 'text',
              regex: /\s+/,
            },
            {
              defaultToken: 'source.js',
            },
          ],
          // EJS block comments inside tags
          ejs_comment: [
            {
              token: 'comment.end',
              regex: /\*\//,
              next: 'ejs',
            },
            {
              token: 'comment.block',
              regex: /.+/,
            },
            {
              defaultToken: 'comment.block',
            },
          ],
          // HTML tag states with EJS support
          'html-tag-open': [
            // EJS tags inside HTML tags
            {
              token: 'constant.language',
              regex: /<%[\-=~]?/,
              next: 'html-tag-ejs',
            },
            // Tag name
            {
              token: 'entity.name.tag',
              regex: /[a-zA-Z0-9_\-:]+/,
              next: 'html-tag-attributes',
            },
          ],
          'html-tag-close': [
            // Closing tag name
            {
              token: 'entity.name.tag',
              regex: /[a-zA-Z0-9_\-:]+/,
            },
            // Close bracket
            {
              token: 'meta.tag',
              regex: />/,
              next: 'start',
            },
          ],
          'html-tag-attributes': [
            // EJS tags in attributes
            {
              token: 'constant.language',
              regex: /<%[\-=~]?/,
              next: 'html-tag-ejs',
            },
            // Close tag
            {
              token: 'meta.tag',
              regex: /\/?>/,
              next: 'start',
            },
            // Attribute name
            {
              token: 'entity.other.attribute-name',
              regex: /[a-zA-Z0-9_\-:]+/,
            },
            // Equals
            {
              token: 'keyword.operator',
              regex: /=/,
            },
            // Attribute value - double quoted (start)
            {
              token: 'string.quoted.double',
              regex: /"/,
              next: 'html-attr-value-double',
            },
            // Attribute value - single quoted (start)
            {
              token: 'string.quoted.single',
              regex: /'/,
              next: 'html-attr-value-single',
            },
            // Whitespace
            {
              token: 'text',
              regex: /\s+/,
            },
          ],
          // Double-quoted attribute value with EJS support
          'html-attr-value-double': [
            // EJS tags inside attribute value
            {
              token: 'constant.language',
              regex: /<%[\-=~]?/,
              next: 'html-attr-value-ejs-double',
            },
            // End of double-quoted value
            {
              token: 'string.quoted.double',
              regex: /"/,
              next: 'html-tag-attributes',
            },
            // Content inside quotes
            {
              token: 'string.quoted.double',
              regex: /[^"<%]+/,
            },
            {
              defaultToken: 'string.quoted.double',
            },
          ],
          // Single-quoted attribute value with EJS support
          'html-attr-value-single': [
            // EJS tags inside attribute value
            {
              token: 'constant.language',
              regex: /<%[\-=~]?/,
              next: 'html-attr-value-ejs-single',
            },
            // End of single-quoted value
            {
              token: 'string.quoted.single',
              regex: /'/,
              next: 'html-tag-attributes',
            },
            // Content inside quotes
            {
              token: 'string.quoted.single',
              regex: /[^'<%]+/,
            },
            {
              defaultToken: 'string.quoted.single',
            },
          ],
          // EJS inside double-quoted attribute value
          'html-attr-value-ejs-double': [
            {
              token: 'constant.language',
              regex: /%>/,
              next: 'html-attr-value-double',
            },
            {
              token: 'comment.line.double-slash',
              regex: /\/\/.*$/,
            },
            {
              token: 'string.quoted.single',
              regex: /'(?:\\.|[^'])*'/,
            },
            {
              token: 'string.quoted.double',
              regex: /"(?:\\.|[^"])*"/,
            },
            {
              token: 'constant.numeric',
              regex: /\b\d+(?:\.\d+)?\b/,
            },
            {
              token: 'keyword',
              regex:
                /\b(?:if|else|for|while|function|return|let|const|var|new|switch|case|break|continue|in|of|try|catch|finally|throw|class|extends|super|import|from|export|default|this|await|async|yield)\b/,
            },
            {
              token: 'constant.language',
              regex: /\b(?:true|false|null|undefined)\b/,
            },
            {
              token: 'keyword.operator',
              regex: /[+\-*\/%=!<>|&^~]+/,
            },
            {
              token: 'paren.lparen',
              regex: /[({\[]/,
            },
            {
              token: 'paren.rparen',
              regex: /[)}\]]/,
            },
            {
              token: 'punctuation.operator',
              regex: /[;,.:]/,
            },
            {
              token: ['punctuation.operator', 'entity.name.function'],
              regex: /(\.)([A-Za-z_$][A-Za-z0-9_$]*)(?=\s*\()/,
            },
            {
              token: 'entity.name.function',
              regex:
                /\b(?!if|for|while|switch|catch|function|return|class|new|else|try|finally|throw|import|export|default|await|async|super|this)[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\()/,
            },
            {
              token: 'identifier',
              regex: /[A-Za-z_$][A-Za-z0-9_$]*/,
            },
            {
              token: 'text',
              regex: /\s+/,
            },
            {
              defaultToken: 'source.js',
            },
          ],
          // EJS inside single-quoted attribute value
          'html-attr-value-ejs-single': [
            {
              token: 'constant.language',
              regex: /%>/,
              next: 'html-attr-value-single',
            },
            {
              token: 'comment.line.double-slash',
              regex: /\/\/.*$/,
            },
            {
              token: 'string.quoted.single',
              regex: /'(?:\\.|[^'])*'/,
            },
            {
              token: 'string.quoted.double',
              regex: /"(?:\\.|[^"])*"/,
            },
            {
              token: 'constant.numeric',
              regex: /\b\d+(?:\.\d+)?\b/,
            },
            {
              token: 'keyword',
              regex:
                /\b(?:if|else|for|while|function|return|let|const|var|new|switch|case|break|continue|in|of|try|catch|finally|throw|class|extends|super|import|from|export|default|this|await|async|yield)\b/,
            },
            {
              token: 'constant.language',
              regex: /\b(?:true|false|null|undefined)\b/,
            },
            {
              token: 'keyword.operator',
              regex: /[+\-*\/%=!<>|&^~]+/,
            },
            {
              token: 'paren.lparen',
              regex: /[({\[]/,
            },
            {
              token: 'paren.rparen',
              regex: /[)}\]]/,
            },
            {
              token: 'punctuation.operator',
              regex: /[;,.:]/,
            },
            {
              token: ['punctuation.operator', 'entity.name.function'],
              regex: /(\.)([A-Za-z_$][A-Za-z0-9_$]*)(?=\s*\()/,
            },
            {
              token: 'entity.name.function',
              regex:
                /\b(?!if|for|while|switch|catch|function|return|class|new|else|try|finally|throw|import|export|default|await|async|super|this)[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\()/,
            },
            {
              token: 'identifier',
              regex: /[A-Za-z_$][A-Za-z0-9_$]*/,
            },
            {
              token: 'text',
              regex: /\s+/,
            },
            {
              defaultToken: 'source.js',
            },
          ],
          // EJS inside HTML tags
          'html-tag-ejs': [
            {
              token: 'constant.language',
              regex: /%>/,
              next: 'html-tag-attributes',
            },
            // Same JS highlighting as in ejs state
            {
              token: 'comment.line.double-slash',
              regex: /\/\/.*$/,
            },
            {
              token: 'string.quoted.single',
              regex: /'(?:\\.|[^'])*'/,
            },
            {
              token: 'string.quoted.double',
              regex: /"(?:\\.|[^"])*"/,
            },
            {
              token: 'constant.numeric',
              regex: /\b\d+(?:\.\d+)?\b/,
            },
            {
              token: 'keyword',
              regex:
                /\b(?:if|else|for|while|function|return|let|const|var|new|switch|case|break|continue|in|of|try|catch|finally|throw|class|extends|super|import|from|export|default|this|await|async|yield)\b/,
            },
            {
              token: 'constant.language',
              regex: /\b(?:true|false|null|undefined)\b/,
            },
            {
              token: 'keyword.operator',
              regex: /[+\-*\/%=!<>|&^~]+/,
            },
            {
              token: 'paren.lparen',
              regex: /[({\[]/,
            },
            {
              token: 'paren.rparen',
              regex: /[)}\]]/,
            },
            {
              token: 'punctuation.operator',
              regex: /[;,.:]/,
            },
            {
              token: ['punctuation.operator', 'entity.name.function'],
              regex: /(\.)([A-Za-z_$][A-Za-z0-9_$]*)(?=\s*\()/,
            },
            {
              token: 'entity.name.function',
              regex:
                /\b(?!if|for|while|switch|catch|function|return|class|new|else|try|finally|throw|import|export|default|await|async|super|this)[A-Za-z_$][A-Za-z0-9_$]*(?=\s*\()/,
            },
            {
              token: 'identifier',
              regex: /[A-Za-z_$][A-Za-z0-9_$]*/,
            },
            {
              token: 'text',
              regex: /\s+/,
            },
            {
              defaultToken: 'source.js',
            },
          ],
        }
      }
      oop.inherits(MarkdownSimpleHighlightRules, TextHighlightRules)

      const Mode = function (this: AceMode) {
        this.HighlightRules = MarkdownSimpleHighlightRules as unknown as new () => AceHighlightRules
      }
      oop.inherits(Mode, TextMode)
      ;(function (this: AceMode) {
        this.$id = 'ace/mode/markdown_simple'
      }).call(Mode.prototype)

      exports.Mode = Mode as unknown as new () => AceMode
    },
  )
}
