import { test } from '@playwright/test'
import { competitorsFixesCrud } from './crud/competitors-fixes'
import { gapsProfilePickersCrud } from './crud/gaps-profile-pickers'
import { pageMarketsProjectsCrud } from './crud/page-markets-projects'
import { questionsCrud } from './crud/questions'
import { topicsCrud } from './crud/topics'

/**
 * Create, edit, remove, move, bulk and Undo across CiteFox (feat/crud), on the
 * real engine with the seeded two-market TextBolt project (no network). Each
 * area registers its tests from `tests/e2e/crud/<area>.ts`; every new drawer
 * is screenshotted at 1440×900 and 1134×770 (`drawerShots`), and every new
 * drill checks that the drawer's count equals the number clicked.
 */
test.describe('crud: questions', questionsCrud)
test.describe('crud: topics', topicsCrud)
test.describe('crud: competitors and fixes', competitorsFixesCrud)
test.describe('crud: page settings, markets and projects', pageMarketsProjectsCrud)
test.describe('crud: content gaps, buyer profile and pickers', gapsProfilePickersCrud)
