/**
 * Add a page as a drawer (`?drawer=add-page`, tracking.md §10). Open it with
 * `openDrawer('add-page', { 'addpage.url': url, 'addpage.group': groupId })`.
 */
export { AddPageDrawer, type AddPageDrawerProps } from './AddPageDrawer'
export { addPageParamsPatch, parseAddPageParams } from './model'
