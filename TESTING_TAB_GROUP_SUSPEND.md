# Manual Testing Guide: Tab Group Suspend/Unsuspend Features

## Feature Overview
Added new functionality to suspend and unsuspend all tabs within a tab group.

## Files Modified
1. `modules/TabParkController.ts` - Added `parkTabGroup()` and `unsuspendTabGroup()` functions
2. `modules/ContextMenuController.ts` - Added "Suspend Tab Group" and "Unsuspend Tab Group" menu items
3. `manifest.json` - Added commands for suspend/unsuspend tab group (available via context menu)
4. `_locales/en/messages.json` - Added English localization for both features
5. `_locales/ru/messages.json` - Added Russian localization for both features
6. `modules/TabObserver.ts` - Fixed bug with audible tab suspension
7. `popup.html` - Added "Suspend Group" and "Unsuspend Group" buttons to extension popup
8. `popup.ts` - Added click handlers for group suspend/unsuspend buttons
9. `modules/PopupController.ts` - Added `isTabInGroup` check to popup response
10. `modules/BGMessageListener.ts` - Added message handlers for suspend/unsuspend tab group

## How to Test

### Setup
1. Build the extension: `npm run build`
2. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `build_dir` folder

### Test Case 1: Suspend Tab Group via Popup Button
**Steps:**
1. Create a tab group:
   - Right-click on a tab → "Add tab to new group"
   - Or select multiple tabs → right-click → "Add to group"
2. Add 3-5 tabs to the group
3. Click on any tab in the group to make it active
4. Click on the extension icon to open popup
5. Click on "Group" button in the Suspend section

**Expected Result:**
- "Group" button should be enabled (not grayed out)
- All tabs in the group should be suspended
- Tabs NOT in the group should remain active
- Suspended tabs should show the park.html page
- Popup should close after suspension

### Test Case 2: Suspend Tab Group via Context Menu
**Steps:**
1. Create a tab group:
   - Right-click on a tab → "Add tab to new group"
   - Or select multiple tabs → right-click → "Add to group"
2. Add 3-5 tabs to the group
3. Right-click on any tab in the group
4. Select "Tab Suspender" → "Suspend Tab Group"

**Expected Result:**
- All tabs in the group should be suspended
- Tabs NOT in the group should remain active
- Suspended tabs should show the park.html page

### Test Case 3: Unsuspend Tab Group via Popup Button
**Steps:**
1. Create a tab group with multiple tabs
2. Suspend all tabs in the group (Test Case 1 or 2)
3. Click on any suspended tab in the group
4. Click on the extension icon to open popup
5. Click on "Group" button in the Unsuspend section

**Expected Result:**
- All suspended tabs in the group should be unsuspended
- Tabs NOT in the group should remain unchanged
- Popup should close after unsuspend

### Test Case 4: Context Menu - Unsuspend Tab Group
**Steps:**
1. Create a tab group with multiple tabs
2. Suspend all tabs in the group (Test Case 1)
3. Right-click on any suspended tab in the group
4. Select "Tab Suspender" → "Unsuspend Tab Group"

**Expected Result:**
- All suspended tabs in the group should be unsuspended
- Tabs NOT in the group should remain unchanged

### Test Case 5: Popup Button Disabled for Tab NOT in Group
**Steps:**
1. Create some tabs WITHOUT adding them to a group
2. Click on an ungrouped tab to make it active
3. Click on the extension icon to open popup
4. Look at the "Group" button in the Suspend section

**Expected Result:**
- "Group" button should be disabled (grayed out)
- Button should not respond to clicks
- Other buttons (Tab, Window, All) should remain enabled

### Test Case 6: Tab NOT in Group - Context Menu
**Steps:**
1. Create some tabs WITHOUT adding them to a group
2. Right-click on an ungrouped tab
3. Click "Tab Suspender" → "Suspend Tab Group"

**Expected Result:**
- Nothing should happen (tab is not in a group)
- Console should show warning: "Cannot suspend tab group: tab is not in a group"

### Test Case 7: Exception Tabs in Group
**Steps:**
1. Create a tab group
2. Add tabs to the group:
   - Tab A: Normal webpage
   - Tab B: Playing audio (YouTube, music site)
   - Tab C: Pinned tab
3. Right-click on Tab A → "Suspend Tab Group"

**Expected Result:**
- Tab A should be suspended
- Tab B (audible) should NOT be suspended (if "Ignore Audible" setting is enabled)
- Tab C (pinned) should NOT be suspended (if "Pinned Tabs" setting is enabled)

### Test Case 8: Multiple Groups
**Steps:**
1. Create Group 1 with 3 tabs
2. Create Group 2 with 3 tabs
3. Right-click on a tab in Group 1
4. Click "Suspend Tab Group"

**Expected Result:**
- Only tabs in Group 1 should be suspended
- Tabs in Group 2 should remain active

### Test Case 9: Mixed Window Tabs
**Steps:**
1. Create two browser windows
2. In Window 1: Create a group with 3 tabs
3. In Window 2: Create a group with 3 tabs (can have same groupId)
4. In Window 1: Right-click on grouped tab → "Suspend Tab Group"

**Expected Result:**
- Only tabs in Window 1's group should be suspended
- Window 2's tabs should remain active

## Verification Checklist
- [ ] Popup buttons appear (Group button in Suspend and Unsuspend sections)
- [ ] Group button is disabled when tab is NOT in a group
- [ ] Group button is enabled when tab IS in a group
- [ ] Context menu items appear (Suspend Tab Group & Unsuspend Tab Group)
- [ ] Only tabs in the same group are suspended/unsuspended
- [ ] Exception tabs (audible, pinned) are NOT suspended
- [ ] Tabs in other groups are NOT affected
- [ ] Works in different windows
- [ ] Localization works (English and Russian)
- [ ] No console errors
- [ ] Popup closes after successful suspend/unsuspend

## Known Limitations
- If a tab is not in a group (groupId === -1), the function will log a warning and do nothing
- Tab exceptions (audible, pinned, whitelisted) are respected and NOT suspended
- The "Group" button in popup is automatically disabled when current tab is not in a group

## Debugging
To enable debug logging:
1. Open `background.ts`
2. Set `const debug = true;`
3. Rebuild and reload extension
4. Check console for detailed logs

## Related Commands (Keyboard Shortcuts)
- **Suspend Tab**: Alt+S (Cmd+Shift+S on Mac)
- **Suspend All Other**: Alt+O (Cmd+Shift+O on Mac)
- **Suspend Window**: Alt+W (Cmd+Shift+W on Mac)
- **Unsuspend Current Window**: Alt+U (Cmd+Shift+U on Mac)

**Note:** Chrome limits extensions to 4 keyboard shortcuts maximum. The "Suspend Tab Group" and "Unsuspend Tab Group" commands are available via context menu but do not have default keyboard shortcuts.
