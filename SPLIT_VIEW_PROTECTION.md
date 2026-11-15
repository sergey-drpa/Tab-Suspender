# Chrome Split View Protection

## Проблема

Chrome Split View (доступно с версии 145+) позволяет отображать две вкладки side-by-side. Однако если Tab Suspender автоматически делает `discard` вкладки, находящейся в **активном** Split View (когда пользователь на него смотрит), она превращается в **черный экран** и становится невосстановимой. Пользователь вынужден закрывать и заново открывать вкладку.

## Решение

Добавлена автоматическая защита вкладок в **АКТИВНЫХ** Split View от автоматической приостановки и discard.

**ВАЖНО**: Защита работает **ТОЛЬКО** для активных Split Views (когда хотя бы одна вкладка в Split View активна). Если Split View не активен (пользователь переключился на другую вкладку), suspend/discard работают в штатном режиме.

### Изменения

#### 1. Расширенная типизация (`modules/typing/chrome-extended.d.ts`)
```typescript
declare namespace chrome.tabs {
    export const SPLIT_VIEW_ID_NONE: -1;

    export interface Tab {
        splitViewId?: number; // ID Split View или -1
    }
}
```

#### 2. Новая настройка (`modules/Settings.ts`)
- **Имя**: `ignoreSuspendSplitViewTabs`
- **Тип**: `boolean`
- **По умолчанию**: `true` (защита включена)
- **Описание**: Предотвращает автоматическую приостановку вкладок в Split View

#### 3. Защита от автоматической приостановки в `TabManager.isTabException()` (`modules/TabManager.ts:798-827`)
```typescript
// Split View Tab (Chrome 145+)
// Prevent discard of tabs in ACTIVE Split View - they become black screen and unrecoverable
// Protection only applies to Split Views that are currently active (user is viewing them)
if (await settings.get('ignoreSuspendSplitViewTabs')) {
    const SPLIT_VIEW_ID_NONE = -1;
    const splitViewIdNone = (chrome.tabs as any).SPLIT_VIEW_ID_NONE ?? SPLIT_VIEW_ID_NONE;
    const splitViewId = (tab as any).splitViewId;

    // If tab is in Split View, check if the Split View is currently active
    if (splitViewId !== undefined && splitViewId !== splitViewIdNone) {
        try {
            // Query all tabs in the same Split View (same window + same splitViewId)
            const tabsInSplitView = await chrome.tabs.query({
                windowId: tab.windowId,
                splitViewId: splitViewId
            });

            // Check if at least one tab in this Split View is active
            const hasActiveTab = tabsInSplitView.some(t => t.active === true);

            // Only protect if Split View is currently active
            if (hasActiveTab) {
                return true; // Active Split View - protect from suspend
            }
        } catch (e) {
            // Fallback: if query fails (old Chrome), allow suspension
            console.warn('[isTabException] Split View query failed:', e);
        }
    }
}
```

**Ключевые моменты**:
- Проверяется `splitViewId !== -1` (вкладка в Split View)
- Через `chrome.tabs.query` находятся все вкладки с таким же `splitViewId`
- Проверяется наличие хотя бы одной активной вкладки (`tab.active === true`)
- Защита работает **ТОЛЬКО** если Split View активен

#### 4. КРИТИЧЕСКАЯ защита от discard в `discardTab()` (`modules/TabParkController.ts:353-395`)
```typescript
async function discardTab(tabId) {
    // CRITICAL: Never discard tabs in ACTIVE Split View (Chrome 145+)
    // Discarding a Split View tab causes unrecoverable black screen
    // Protection applies ONLY to currently active Split Views
    // This check runs ALWAYS, independent of ignoreSuspendSplitViewTabs setting
    try {
        const tab = await chrome.tabs.get(tabId);

        const SPLIT_VIEW_ID_NONE = -1;
        const splitViewIdNone = (chrome.tabs as any).SPLIT_VIEW_ID_NONE ?? SPLIT_VIEW_ID_NONE;
        const splitViewId = (tab as any).splitViewId;

        // If tab is in Split View, check if Split View is currently active
        if (splitViewId !== undefined && splitViewId !== splitViewIdNone) {
            try {
                // Query all tabs in the same Split View
                const tabsInSplitView = await chrome.tabs.query({
                    windowId: tab.windowId,
                    splitViewId: splitViewId
                });

                // Check if at least one tab in this Split View is active
                const hasActiveTab = tabsInSplitView.some(t => t.active === true);

                // Only protect if Split View is currently active
                if (hasActiveTab) {
                    console.log(`[discardTab] Skipping discard for ACTIVE Split View tab ${tabId}`);
                    return;
                }
            } catch (e) {
                // Fallback: if query fails (old Chrome), allow discard
                console.warn('[discardTab] Split View query failed:', e);
            }
        }
    } catch (e) {
        console.warn(`[discardTab] Cannot get tab ${tabId}, skipping discard:`, e);
        return;
    }

    // Safe to discard - not in active Split View
    chrome.tabs.discard(tabId, function() {
        hasLastError();
    });
}
```

**ВАЖНО**:
- Защита от discard работает **ВСЕГДА**, независимо от настройки `ignoreSuspendSplitViewTabs`
- Защита применяется **ТОЛЬКО** к активным Split Views (когда хотя бы одна вкладка активна)
- Если Split View не активен, discard работает в штатном режиме

### Обратная совместимость

✅ **Безопасно для старых версий Chrome** (< 145):
- Если `splitViewId` не существует → проверка возвращает `undefined`
- Используется `??` оператор для fallback на `-1`
- Никаких ошибок, расширение работает как раньше

✅ **Безопасно для Chrome 145+**:
- Проверяет `chrome.tabs.SPLIT_VIEW_ID_NONE` константу
- Определяет вкладки в Split View по `tab.splitViewId !== -1`
- Автоматически защищает от discard

### Тестирование

Добавлены комплексные тесты (`test/modules/SplitViewProtection.test.ts`):

1. ✅ **Обратная совместимость**
   - Chrome без `splitViewId` API
   - Chrome 145+ с константой `SPLIT_VIEW_ID_NONE`

2. ✅ **Определение АКТИВНОГО Split View**
   - Вкладка в активном Split View → исключение (защита)
   - Вкладка НЕ в Split View → можно suspend
   - Вкладка в неактивном Split View → можно suspend

3. ✅ **Управление настройкой suspend**
   - `ignoreSuspendSplitViewTabs: true` → защита работает для активных Split Views
   - `ignoreSuspendSplitViewTabs: false` → защита отключена для suspend

4. ✅ **Discard Protection (КРИТИЧЕСКАЯ)**
   - Активный Split View → discard БЛОКИРУЕТСЯ (независимо от настройки)
   - Неактивный Split View → discard разрешен
   - Обычные вкладки → discard работает нормально
   - Защита работает даже при `ignoreSuspendSplitViewTabs: false`

5. ✅ **Множественные Split Views**
   - Каждый активный Split View защищен индивидуально

**Результат**: 13/13 тестов проходят

### API Reference

**Chrome Split View API** (Chrome 145+):
- **Свойство**: `chrome.tabs.Tab.splitViewId`
- **Тип**: `number` (optional)
- **Значения**:
  - `-1` (`chrome.tabs.SPLIT_VIEW_ID_NONE`) - вкладка НЕ в Split View
  - `> 0` - ID конкретного Split View

**Query Support**:
```javascript
// Найти вкладки в конкретном Split View
chrome.tabs.query({ splitViewId: 123 })

// Найти вкладки НЕ в Split View
chrome.tabs.query({ splitViewId: chrome.tabs.SPLIT_VIEW_ID_NONE })
```

### Использование

**По умолчанию**: Защита Split View включена автоматически.

**Отключить** (не рекомендуется):
1. Открыть настройки Tab Suspender
2. Найти "Ignore Split View Tabs"
3. Снять галочку

**Проверить поддержку Chrome**:
```javascript
if ('splitViewId' in tab) {
    console.log('Chrome 145+ с Split View API');
}
```

### Источники

- [Chrome Split View Documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Google Chrome Split View Feature (2026)](https://9to5google.com/2026/02/19/chrome-split-view-pdf/)
- [Chrome Split View API Reference](https://www.stefanjudis.com/blog/chrome-split-views/)

### Технические детали

**Где происходит проверка**:
- `TabManager.isTabException()` - перед автоматической приостановкой (зависит от настройки `ignoreSuspendSplitViewTabs`, проверяет активность)
- `discardTab()` в `TabParkController` - **ВСЕГДА** защищает от discard **АКТИВНЫХ** Split Views (независимо от настроек)
- `TabObserver` - использует `isTabException()` перед discard
- `TabParkController.parkTabs()` - использует `isTabException()` перед park

**Логика определения активности**:
1. Проверяется `tab.splitViewId !== -1` (вкладка в Split View)
2. Через `chrome.tabs.query({ windowId, splitViewId })` находятся все вкладки в этом Split View
3. Проверяется `tabsInSplitView.some(t => t.active === true)` - есть ли активные вкладки
4. Защита срабатывает **ТОЛЬКО** если есть хотя бы одна активная вкладка

**Аналогичная защита существует для**:
- Pinned tabs (`tab.pinned === true`)
- Audible tabs (`tab.audible === true`)
- Grouped tabs (`tab.groupId !== -1`)
- **Split View tabs** (`tab.splitViewId !== -1`) ← НОВОЕ

### Возможные улучшения

- [ ] Добавить UI для управления настройкой в popup/options
- [ ] Показывать индикатор Split View в списке вкладок
- [ ] Логировать когда защита срабатывает (для debugging)
