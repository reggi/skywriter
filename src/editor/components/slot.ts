import type {SlotElements} from '../utils/dom.ts'
import {initSearch, updateSelectionDisplay, type SearchResult, type TemplateSlotInfo} from '../utils/search-utils.ts'
import {EditorModule} from '../utils/types.ts'

function updateSlot(info: TemplateSlotInfo) {
  updateSelectionDisplay(info, 'slot-search', 'slot')
}

export const slot = {
  init: (options: {slotElements: SlotElements; onSelect: (result: SearchResult) => void; onClear: () => void}) =>
    initSearch(
      options.slotElements.slotSearch,
      options.slotElements.slotDropdown,
      options.onSelect,
      options.onClear,
      'slot',
    ),
  update: (options: {slot: TemplateSlotInfo}) => updateSlot(options.slot),
} satisfies EditorModule
