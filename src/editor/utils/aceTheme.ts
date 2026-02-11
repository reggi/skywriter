/* Custom Monokai Theme with Markdown Heading Support */

interface AceThemeExports {
  isDark: boolean
  cssClass: string
  cssText: string
}

interface AceDom {
  importCssString(css: string, cssClass: string): void
}

interface AceGlobal {
  define(
    name: string,
    deps: string[],
    factory: (require: (name: string) => AceDom, exports: AceThemeExports) => void,
  ): void
}

export function aceTheme(ace: AceGlobal) {
  ace.define(
    'ace/theme/monokai_custom',
    ['require', 'exports', 'module', 'ace/lib/dom'],
    function (require: (name: string) => AceDom, exports: AceThemeExports) {
      const dom = require('ace/lib/dom')
      exports.isDark = true
      exports.cssClass = 'ace-monokai-custom'
      exports.cssText = `/* Custom Monokai w/ Markdown Heading Support */
.ace-monokai-custom .ace_gutter {
  background: #2F3129;
  color: #8F908A;
}
.ace-monokai-custom {
  background-color: #272822;
  color: #F8F8F2;
  font-family: Monaco, Menlo, "SF Mono", Consolas, "Liberation Mono", "Courier New", monospace;
}
.ace-monokai-custom .ace_cursor {
  color: #F8F8F0;
}
.ace-monokai-custom .ace_marker-layer .ace_selection {
  background: #49483E;
}
.ace-monokai-custom .ace_marker-layer .ace_active-line {
  background: #202020;
}
.ace-monokai-custom .ace_keyword {
  color: #F92672;
}
.ace-monokai-custom .ace_constant.ace_language {
  color: #F92672;
  font-weight: 600;
}
.ace-monokai-custom .ace_constant.ace_numeric {
  color: #AE81FF;
}
.ace-monokai-custom .ace_string {
  color: #E6DB74;
}
.ace-monokai-custom .ace_comment {
  color: #A6A6A6;
}
.ace-monokai-custom .ace_entity.ace_name.ace_function,
.ace-monokai-custom .ace_support.ace_function,
.ace-monokai-custom .ace_storage {
  color: #66D9EF;
}
.ace-monokai-custom .ace_markup.ace_heading {
  color: #F92672;
  font-weight: 700;
}
.ace-monokai-custom .ace_markup.ace_list {
  color: #A6E22E;
}
.ace-monokai-custom .ace_markup.ace_quote, 
.ace-monokai-custom .ace_quote {
  color: #66D9EF;
  font-style: italic;
}
.ace-monokai-custom .ace_italic {
  font-style: italic;
  color: #F8F8F2;
}
.ace-monokai-custom .ace_bold {
  font-weight: 700 !important;
  color: #F8F8F2;
  text-shadow: 0 0 0.5px #F8F8F2, 0 0 0.5px #F8F8F2;
}
.ace-monokai-custom .ace_markup.ace_underline {
  text-decoration: underline;
}
.ace-monokai-custom .ace_support.ace_constant {
  color: #66D9EF;
}
.ace-monokai-custom .ace_invalid {
  color: #F8F8F2;
  background-color: #F92672;
}
.ace-monokai-custom .ace_markup.ace_link {
  color: #66D9EF;
  text-decoration: underline;
}
.ace-monokai-custom .ace_variable {
  color: #FD971F;
}
.ace-monokai-custom .ace_paren.ace_lparen,
.ace-monokai-custom .ace_paren.ace_rparen {
  color: #F8F8F2;
}
.ace-monokai-custom .ace_meta.ace_tag {
  color: #F92672;
}
.ace-monokai-custom .ace_entity.ace_name.ace_tag {
  color: #A6E22E;
  font-weight: 600;
}
.ace-monokai-custom .ace_entity.ace_other.ace_attribute-name {
  color: #FD971F;
}
.ace-monokai-custom .ace_string.ace_attribute-value {
  color: #E6DB74;
}
.ace-monokai-custom .ace_text {
  color: #F8F8F2;
}
.ace-monokai-custom .ace_punctuation.ace_tag-close {
  color: #F92672;
}
.ace-monokai-custom .ace_tag-open {
  color: #F92672;
}
.ace-monokai-custom .ace_tag-name {
  color: #A6E22E;
  font-weight: 600;
}
.ace-monokai-custom .ace_attribute-name {
  color: #FD971F;
}
.ace-monokai-custom .ace_attribute-value {
  color: #E6DB74;
}
`
      dom.importCssString(exports.cssText, exports.cssClass)
    },
  )
}
