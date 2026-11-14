# Анализ проблемы восстановления вкладок (Tab Restore)

**Дата анализа:** 2025-12-11
**Количество тикетов:** 28
**Критичность:** Высокая (пользователи теряют данные)

---

## Содержание

1. [Обзор проблемы](#обзор-проблемы)
2. [Классификация тикетов](#классификация-тикетов)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Техническая архитектура](#техническая-архитектура)
5. [Выявленные уязвимости](#выявленные-уязвимости)
6. [Предлагаемые решения](#предлагаемые-решения)
7. [План реализации](#план-реализации)

---

## Обзор проблемы

Пользователи сообщают о невозможности восстановить suspended tabs в следующих сценариях:

1. **После рестарта браузера** - suspended tabs становятся "New Tab" или показывают ошибку
2. **После обновления расширения** - старые suspended tabs не работают
3. **При использовании Tab Groups** - скрытые группы теряют suspended tabs
4. **При ошибках расширения** - TypeError приводит к потере всех данных

### Ключевая ошибка в консоли:
```
[TS:dataForParkPage]: TabId: 112844793
TypeError: Cannot read properties of undefined (reading 'toObject')
```

---

## Классификация тикетов

### Категория A: Полная потеря вкладок (12 тикетов)

| Дата | Тикет | Версия | Суть проблемы |
|------|-------|--------|---------------|
| 2025-02-22 | Impossible to restore tabs | 2.0.1 | TypeError при восстановлении |
| 2025-02-22 | how to recover the lost tabs? | 2.0.1 | Все suspended tabs исчезли |
| 2025-02-26 | New Version Does not solve problems | 2.0.1.1 | Старые tabs невосстановимы |
| 2024-04-11 | permanently suspend cannot unsuspend | 1.4.12 | ~30% tabs теряются навсегда |
| 2024-10-28 | Edge Beta - "New Tab" tabs | 1.4.12 | Suspended → New Tab при рестарте |
| 2023-08-04 | Duplicating tabs | 1.4.11 | Дублирование при рестарте |
| 2021-05-22 | Extension crashing | 1.4.3 | Crash → потеря данных |
| 2019-08-12 | Discard by default loses tabs | 1.3.7 | Discard режим теряет tabs |

### Категория B: Невозможность unsuspend (8 тикетов)

| Дата | Тикет | Версия | Суть проблемы |
|------|-------|--------|---------------|
| 2024-05-07 | tab remained suspended after bookmark | 1.4.12 | URL нечитаемый код |
| 2024-03-15 | how do you unsuspend | 1.4.12 | Клик по вкладке не работает |
| 2022-09-22 | Cannot transfer suspended tab | 1.4.11 | URL не декодируется |
| 2023-11-04 | Broken - settings.get is not a function | 1.4.11 | Chrome update сломал расширение |

### Категория C: Tab Groups проблемы (5 тикетов)

| Дата | Тикет | Версия | Суть проблемы |
|------|-------|--------|---------------|
| 2024-05-03 | Tab cleared in hidden group | 1.4.12 | Hide→Unhide group = потеря |
| 2024-04-24 | Tabs in groups don't suspend | 1.4.12 | Groups игнорируются |

### Категория D: Ошибки Chrome/MV3 (3 тикета)

| Дата | Тикет | Версия | Суть проблемы |
|------|-------|--------|---------------|
| 2025-03-12 | Extension removed from Store | 2.0.1.1 | MV3 требования |
| 2024-12-22 | Manifest V3 questions | 1.4.12 | Страх потери tabs |

---

## Root Cause Analysis

### RC-1: TabId меняется при рестарте браузера

**Механизм:**
```
1. Пользователь suspend'ит tab → TabId = 12345
2. URL suspended tab: park.html?tabId=12345&url=...
3. Браузер рестартует
4. Chrome назначает НОВЫЙ TabId = 67890
5. park.ts запрашивает данные по tabId=67890
6. tabInfos хранит данные под ключом 12345
7. findReplacedTabById(67890) → undefined
8. .toObject() → TypeError
```

**Файл:** `modules/BGMessageListener.ts:56`
```typescript
tabInfo: tabManager.findReplacedTabById(request.tabId).toObject(),  // ← CRASH!
```

### RC-2: Асинхронная загрузка данных (Race Condition)

**Механизм:**
```
1. Браузер открывается
2. chrome.storage.local.get() начинает загрузку (async)
3. Park.html загружается БЫСТРЕЕ чем завершается loadTabInfos()
4. sendMessage('[TS:dataForParkPage]')
5. tabInfos ещё пустой {}
6. findReplacedTabById() → undefined
```

**Файл:** `modules/TabManager.ts:108-127`
```typescript
private loadTabInfos() {
    chrome.storage.local.get(this.TAB_INFOS_KEY).then(async (result) => {
        // ... загрузка данных
    }).catch(console.error);  // ← Ошибка просто логируется!
}
```

### RC-3: Отсутствие fallback на URL параметры

**Факт:** URL suspended tab УЖЕ содержит всю необходимую информацию:
```
park.html?tabId=X&url=https://example.com&title=Example&icon=data:image/...
```

**Проблема:** Код пытается получить данные из `tabInfos` вместо парсинга URL параметров как fallback.

### RC-4: Tab Groups + Hide/Unhide

**Механизм:**
```
1. Пользователь создаёт Tab Group
2. Suspend'ит tabs в группе
3. Скрывает группу (Chrome сохраняет в storage)
4. Открывает группу обратно
5. Chrome может создать НОВЫЕ TabId
6. Связь tabId → tabInfos потеряна
```

### RC-5: Потеря данных при ошибках decompress

**Файл:** `modules/TabManager.ts:116`
```typescript
const iTabInfosJson = await this.decompress(iTabInfosCompressedArrayBuffer);
```

Если данные повреждены → decompress выбрасывает ошибку → ВСЕ tabInfos теряются.

---

## Техническая архитектура

### Текущий Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        SUSPEND FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│  1. User suspends tab (TabId=123)                               │
│  2. TabManager создаёт TabInfo объект                           │
│  3. TabInfo сохраняется в this.tabInfos[123]                    │
│  4. Browser navigates to park.html?tabId=123&url=...            │
│  5. saveTabInfos() сжимает и сохраняет в chrome.storage.local   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        RESTORE FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│  1. Park.html загружается                                        │
│  2. park.ts парсит URL → tabId=123                               │
│  3. sendMessage('[TS:dataForParkPage]', {tabId: sender.tab.id}) │
│     ↑ ПРОБЛЕМА: sender.tab.id может быть НОВЫМ после рестарта! │
│  4. BGMessageListener: findReplacedTabById(newTabId)             │
│  5. Если tabInfo не найден → TypeError                           │
│  6. Park page не может восстановить оригинальный URL             │
└─────────────────────────────────────────────────────────────────┘
```

### Хранение данных

```typescript
// chrome.storage.local
{
  "tabInfos": "base64_compressed_json_string"
}

// После декомпрессии
{
  "123": {  // Ключ = TabId
    "id": 123,
    "parkedUrl": "https://example.com",
    "lstCapUrl": "https://example.com",
    "parked": true,
    // ...
  }
}
```

---

## Выявленные уязвимости

### V-1: Критичная - Отсутствие null-check
**Файл:** `modules/BGMessageListener.ts:56`
```typescript
// УЯЗВИМЫЙ КОД:
tabInfo: tabManager.findReplacedTabById(request.tabId).toObject(),

// ИСПРАВЛЕНИЕ:
tabInfo: tabManager.findReplacedTabById(request.tabId)?.toObject() ?? null,
```

### V-2: Критичная - Нет fallback на URL params
**Файл:** `park.ts` и `BGMessageListener.ts`

URL содержит всё необходимое для восстановления, но не используется как fallback.

### V-3: Высокая - Race condition при загрузке
**Файл:** `modules/TabManager.ts`

loadTabInfos() не блокирует обработку сообщений до завершения.

### V-4: Средняя - Потеря данных при ошибке decompress
**Файл:** `modules/TabManager.ts:127`
```typescript
}).catch(console.error);  // Просто логирует, не восстанавливает
```

### V-5: Средняя - TabId не сохраняется в URL
URL содержит `tabId`, но это TabId НА МОМЕНТ suspend. При рестарте бесполезен.

---

## Предлагаемые решения

### Решение 1: Graceful Degradation с URL Fallback (КРИТИЧНО)

**Принцип:** Если tabInfo не найден, использовать параметры из URL.

**Реализация в `park.ts`:**
```typescript
// Парсим URL параметры
const urlParams = new URLSearchParams(window.location.search);
const originalUrl = urlParams.get('url');
const originalTitle = urlParams.get('title');
const originalIcon = urlParams.get('icon');

// Запрашиваем данные от background
const parkData = await chrome.runtime.sendMessage({...});

// Fallback если данные не получены
if (!parkData || !parkData.tabInfo) {
    console.warn('TabInfo not found, using URL fallback');
    // Показываем UI с данными из URL
    showFallbackUI(originalUrl, originalTitle, originalIcon);
    return;
}
```

**Реализация в `BGMessageListener.ts`:**
```typescript
const tabInfo = tabManager.findReplacedTabById(request.tabId);
const response: ParkPageDataBGResponse = {
    // ... другие поля
    tabInfo: tabInfo?.toObject() ?? null,  // Защита от null
    fallbackUrl: request.url,  // Передаём URL из запроса как fallback
};
```

### Решение 2: Session-based восстановление

**Принцип:** Генерировать уникальный sessionId при suspend, хранить данные по sessionId вместо tabId.

**Реализация:**
```typescript
// При suspend
const sessionId = crypto.randomUUID();
const parkUrl = `park.html?sessionId=${sessionId}&url=...`;

// Хранение
tabSessions[sessionId] = {
    originalUrl,
    originalTitle,
    originalIcon,
    suspendedAt: Date.now(),
};
```

**Преимущества:**
- sessionId не меняется при рестарте браузера
- Уникален для каждой suspended tab
- Можно восстановить даже после переустановки расширения (если данные экспортированы)

### Решение 3: URL-only режим (Self-Contained)

**Принцип:** ВСЕ необходимые данные закодированы в URL, не требуется background storage.

**Реализация:**
```
park.html?d=BASE64_ENCODED_JSON
```

Где JSON содержит:
```json
{
    "url": "https://example.com",
    "title": "Example Page",
    "icon": "data:image/png;base64,...",
    "suspendedAt": 1702345678
}
```

**Преимущества:**
- Полностью автономно, не зависит от storage
- Работает после переустановки расширения
- Можно поделиться ссылкой на suspended tab

**Недостатки:**
- Длинные URL (особенно со скриншотами)
- Потенциальные проблемы с лимитом длины URL

### Решение 4: Очередь ожидания загрузки данных

**Файл:** `modules/TabManager.ts`

```typescript
private tabInfosLoaded: Promise<void>;
private tabInfosLoadedResolve: () => void;

constructor() {
    this.tabInfosLoaded = new Promise((resolve) => {
        this.tabInfosLoadedResolve = resolve;
    });
    this.loadTabInfos();
}

private async loadTabInfos() {
    try {
        const result = await chrome.storage.local.get(this.TAB_INFOS_KEY);
        // ... загрузка
        this.tabInfosLoadedResolve();
    } catch (e) {
        console.error('Failed to load tabInfos:', e);
        this.tabInfosLoadedResolve(); // Всё равно резолвим
    }
}

// В BGMessageListener
async function handleDataForParkPage(request) {
    await tabManager.tabInfosLoaded;  // Ждём загрузки данных
    const tabInfo = tabManager.findReplacedTabById(request.tabId);
    // ...
}
```

### Решение 5: Восстановление при ошибках decompress

```typescript
private async loadTabInfos() {
    try {
        const result = await chrome.storage.local.get(this.TAB_INFOS_KEY);
        // ... decompress и parse
    } catch (e) {
        console.error('Failed to decompress tabInfos, trying backup:', e);

        // Попытка загрузить backup
        try {
            const backup = await chrome.storage.local.get(this.TAB_INFOS_BACKUP_KEY);
            // ... восстановление из backup
        } catch (backupError) {
            console.error('Backup also failed:', backupError);
        }
    }
}

// Периодическое сохранение backup
private async saveTabInfosWithBackup() {
    // Сначала сохраняем backup предыдущей версии
    const currentData = await chrome.storage.local.get(this.TAB_INFOS_KEY);
    if (currentData[this.TAB_INFOS_KEY]) {
        await chrome.storage.local.set({
            [this.TAB_INFOS_BACKUP_KEY]: currentData[this.TAB_INFOS_KEY]
        });
    }

    // Затем сохраняем текущие данные
    await this.saveTabInfos();
}
```

---

## План реализации

### Фаза 1: Критические исправления (ASAP)

1. **[P0] Добавить null-check в BGMessageListener.ts:56**
   ```typescript
   tabInfo: tabManager.findReplacedTabById(request.tabId)?.toObject() ?? null,
   ```

2. **[P0] Добавить fallback UI в park.ts**
   - Если tabInfo === null, показать UI с данными из URL
   - Кнопка "Restore" использует `searchParams.get('url')`

3. **[P0] Ждать загрузки tabInfos перед обработкой сообщений**

### Фаза 2: Улучшение надёжности

4. **[P1] Реализовать sessionId-based хранение**
   - Мигрировать с tabId на sessionId
   - Обратная совместимость со старыми suspended tabs

5. **[P1] Добавить backup механизм для tabInfos**
   - Периодический backup
   - Восстановление при ошибках

### Фаза 3: Long-term improvements

6. **[P2] URL-only mode как опция**
   - Для параноидальных пользователей
   - Не зависит от storage вообще

7. **[P2] Export/Import suspended tabs**
   - JSON экспорт всех suspended tabs
   - Можно восстановить после переустановки

---

## Метрики успеха

После внедрения исправлений:

- **0 TypeError ошибок** в консоли при восстановлении
- **100% успех** восстановления suspended tabs после рестарта браузера
- **Graceful degradation** вместо crash при отсутствии данных
- **Backup recovery** при повреждении storage

---

## Приложение: Конкретные тикеты для исправления

### Тикет: "Impossible to restore tabs" (2025-02-22)

**Ошибка:**
```
[TS:dataForParkPage]: TabId: 112844793
TypeError: Cannot read properties of undefined (reading 'toObject')
```

**Исправление:** Фаза 1, пункты 1-3

### Тикет: "Tab cleared in hidden group" (2024-05-03)

**Причина:** Chrome создаёт новые TabId при unhide группы

**Исправление:** Фаза 2, пункт 4 (sessionId вместо tabId)

### Тикет: "Edge Beta - New Tab tabs" (2024-10-28)

**Причина:** Race condition при загрузке + отсутствие fallback

**Исправление:** Фаза 1, пункты 2-3
