import type {TemplateElements} from '../utils/dom.ts'
import {EditorModule} from '../utils/types.ts'
import {initSearch, updateSelectionDisplay, type SearchResult, type TemplateSlotInfo} from '../utils/search-utils.ts'

function updateTemplate(info: TemplateSlotInfo) {
  updateSelectionDisplay(info, 'template-search', 'template')
}

export const template = {
  init: (options: {
    templateElements: TemplateElements
    onSelect: (result: SearchResult) => void
    onClear: () => void
  }) =>
    initSearch(
      options.templateElements.templateSearch,
      options.templateElements.templateDropdown,
      options.onSelect,
      options.onClear,
      'template',
    ),
  update: (options: {template: TemplateSlotInfo}) => updateTemplate(options.template),
} satisfies EditorModule
