# Tab Suspender — Test Cases

**Приоритеты:** P0 = критично, P1 = высокий, P2 = средний, P3 = низкий  
**Тип:** Unit = Jest, E2E = Puppeteer, Both = оба нужны  
**Статус:** ✅ покрыт, ⚠️ частично, ❌ не покрыт

---

## 1. АВТОМАТИЧЕСКАЯ ПРИОСТАНОВКА

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 1.1 | Таб приостанавливается через заданный таймаут (30 мин по умолчанию) | P0 | E2E | ✅ | `basic-suspend-restore.test.ts` |
| 1.2 | Активный таб НЕ приостанавливается, даже если истёк таймаут | P0 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.3 | При активации таба счётчик времени сбрасывается в 0 | P0 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.4 | Таб с `status !== 'complete'` не приостанавливается | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.5 | Расширение выключено (`active=false`) → ни один таб не приостанавливается | P1 | Unit | ✅ | `ActiveDisabled.test.ts` |
| 1.6 | Пауза (`pauseTics > 0`) предотвращает приостановку | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.7 | По истечении паузы приостановка возобновляется | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.8 | Адаптивный таймаут увеличивается с ростом частоты посещений | P2 | E2E | ✅ | `adaptive-timeout.test.ts` |
| 1.9 | Приостановка идемпотентна — повторный вызов не ломает состояние | P1 | Unit | ✅ | `AutoSuspension.test.ts` |
| 1.10 | Таб закрыт во время процесса приостановки — ошибок не должно быть | P1 | Unit | ✅ | `AutoSuspension.test.ts` |

---

## 2. ВОССТАНОВЛЕНИЕ ТАБА

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 2.1 | Клик на странице park.html → таб восстанавливается по оригинальному URL | P0 | E2E | ✅ | `basic-suspend-restore.test.ts` |
| 2.2 | `autoRestoreTab=true` → активация приостановленного таба автоматически его восстанавливает | P1 | E2E | ✅ | `auto-restore-tab.test.ts` |
| 2.3 | `reloadTabOnRestore=false` → восстановление через history (bfcache) | P1 | E2E | ✅ | `restore-modes.test.ts` |
| 2.4 | `reloadTabOnRestore=true` → принудительная навигация на оригинальный URL | P1 | E2E | ✅ | `restore-modes.test.ts` |
| 2.5 | После восстановления флаги `parked`, `time`, `suspended_time` сброшены | P1 | Unit | ✅ | `TabRestore.test.ts` |
| 2.6 | Hover на иконку восстанавливает таб (`restoreOnMouseHover=true`) | P2 | E2E | ✅ | `hover-restore.test.ts` |
| 2.7 | Повторное восстановление уже восстановленного таба не вызывает ошибок | P1 | Unit | ✅ | `TabRestore.test.ts` |
| 2.8 | Формы заполнены до приостановки → данные восстановлены после | P1 | E2E | ✅ | `form-data-restore.test.ts` |
| 2.9 | YouTube: временна́я метка видео сохранена и восстановлена в URL | P2 | E2E | ✅ | `url-param-preserve.test.ts` |
| 2.10 | Массовое восстановление всех табов окна — с задержками между восстановлениями | P2 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase B |

---

## 3. WHITELIST / BLACKLIST

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 3.1 | `*.google.com*` совпадает с `mail.google.com` и `drive.google.com` | P0 | Unit | ✅ | `WhiteList.test.ts` |
| 3.2 | Шаблон с `*` в начале, середине и конце | P1 | Unit | ✅ | `WhiteList.test.ts` |
| 3.3 | Таб из whitelist не приостанавливается | P0 | Unit | ✅ | `WhiteList.test.ts` |
| 3.4 | Добавление URL из контекстного меню → сохранение в настройках | P1 | E2E | ✅ | `whitelist-ignore.test.ts` Phase A |
| 3.5 | Удаление паттерна → таб снова становится кандидатом на приостановку | P1 | E2E | ✅ | `whitelist-ignore.test.ts` Phase B |
| 3.6 | Пустой паттерн пропускается без ошибок | P2 | Unit | ✅ | `WhiteList.test.ts` |
| 3.7 | Некорректный regex — caught, не падает extension | P2 | Unit | ✅ | `WhiteList.test.ts` |
| 3.8 | chrome:// и extension:// URL никогда не приостанавливаются | P0 | E2E | ✅ | `protected-urls.test.ts` |
| 3.9 | "Игнорировать таб" (per-session) — таб не приостанавливается до рестарта | P2 | E2E | ✅ | `whitelist-ignore.test.ts` Phase C |

---

## 4. FAVICON И СКРИНШОТЫ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 4.1 | SVG favicon с явными width/height — не теряется при приостановке | P0 | E2E | ✅ | `favicon-loss.test.ts` Phase A |
| 4.2 | SVG favicon без width/height (только viewBox) — корректно отображается | P0 | E2E | ✅ | `favicon-loss.test.ts` Phase B |
| 4.3 | Полный цикл suspend→discard→restore, favicon сохранён | P0 | E2E | ✅ | `favicon-loss.test.ts` Phase C |
| 4.4 | Favicon не теряется при навигации по нескольким страницам до приостановки | P1 | E2E | ✅ | `favicon-nav-stress.test.ts` |
| 4.5 | Скриншот захватывается до приостановки и отображается на park.html | P1 | E2E | ✅ | `screenshot-settings.test.ts` Phase A |
| 4.6 | `screenshotsEnabled=false` → park.html показывает только заголовок и иконку | P2 | E2E | ✅ | `screenshot-settings.test.ts` Phase B |
| 4.7 | Скриншот сжат (gzip) и хранится в IndexedDB | P2 | Unit | ⚠️ | `ScreenshotController.test.ts` |
| 4.8 | Таймаут захвата скриншота — приостановка всё равно происходит без него | P1 | Unit | ✅ | `ParkPageScreenshotTimeout.test.ts` |
| 4.9 | Повторная попытка захвата иконки (до 2 раз с 100мс) при пустом favIconUrl | P2 | Unit | ❌ | |
| 4.10 | Скриншот не захватывается при Ctrl+Click приостановке | P2 | Unit | ❌ | |
| 4.11 | Качество скриншота 10% vs 100% — разница в размере хранилища | P3 | Unit | ❌ | |

---

## 5. PINNED / AUDIBLE / GROUPED ТАБЫ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 5.1 | Pinned таб при `pinned=true` → НЕ приостанавливается | P0 | E2E | ✅ | `pinned-tab-protection.test.ts` Phase A |
| 5.2 | Pinned таб при `pinned=false` → приостанавливается по таймауту | P1 | E2E | ✅ | `pinned-tab-protection.test.ts` Phase B |
| 5.3 | Audible таб при `ignoreAudible=true` → счётчик не накапливается | P1 | Unit | ✅ | `ActiveTabAudible.test.ts` |
| 5.4 | Таб перестал воспроизводить звук → счётчик возобновляется | P1 | Unit | ❌ | |
| 5.5 | Сгруппированный таб при `ignoreSuspendGroupedTabs=true` → НЕ приостанавливается | P1 | Unit | ✅ | `TabGroupSuspend.test.ts` |
| 5.6 | Приостановка группы табов по команде "Suspend Tab Group" | P1 | Unit | ✅ | `TabGroupSuspend.test.ts` |
| 5.7 | Восстановление группы табов с задержкой 1 с между каждым | P2 | Unit | ✅ | `UnsuspendCurrentTabInGroup.test.ts` |
| 5.8 | Восстановление только текущего таба из группы (не всей группы) | P2 | Unit | ✅ | `UnsuspendCurrentTabInGroup.test.ts` |
| 5.9 | Tab group fix при восстановлении сессии браузера | P2 | Unit | ✅ | `GroupRestoreFix.test.ts` |

---

## 6. SPLIT VIEW ЗАЩИТА

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 6.1 | Таб в активном Split View НЕ discardится | P0 | Unit | ✅ | `SplitViewProtection.test.ts` |
| 6.2 | Split View завершён → таб может быть discarded | P1 | Unit | ✅ | `SplitViewProtection.test.ts` |
| 6.3 | Chrome без поддержки splitViewId → graceful fallback (нет ошибок) | P2 | Unit | ✅ | `SplitViewProtection.test.ts` |
| 6.4 | `splitViewId === -1` (не в split view) → таб discardится нормально | P1 | Unit | ✅ | `SplitViewProtection.test.ts` |

---

## 7. БАТАРЕЯ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 7.1 | `autoSuspendOnlyOnBatteryOnly=true`, заряжается → приостановки нет | P1 | Unit | ❌ | |
| 7.2 | `autoSuspendOnlyOnBatteryOnly=true`, от батареи → приостановка работает | P1 | Unit | ❌ | |
| 7.3 | Уровень батареи выше порога → приостановки нет | P2 | Unit | ❌ | |
| 7.4 | Уровень батареи ниже порога → приостановка работает | P2 | Unit | ❌ | |
| 7.5 | Battery API недоступен → функция корректно отключается | P3 | Unit | ❌ | |

---

## 8. AUTO-CLOSE ТАБОВ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 8.1 | Общее кол-во табов > лимита → самый "бесполезный" (min rank) закрывается | P1 | Unit | ❌ | |
| 8.2 | Сгруппированный таб при `ignoreCloseGroupedTabs=true` → не закрывается | P2 | Unit | ❌ | |
| 8.3 | Ранг рассчитывается правильно (формула: `active_time² × (swch+1) - time×k`) | P2 | Unit | ❌ | |
| 8.4 | Закрытый таб попадает в closeHistory (до 300 записей) | P2 | Unit | ❌ | |
| 8.5 | Общее кол-во табов ≤ лимита → ни один таб не закрывается | P1 | Unit | ❌ | |

---

## 9. ДИСКАРДИНГ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 9.1 | `discardTabAfterSuspendWithTimeout=true` → приостановленный таб auto-discard через timeout×factor | P1 | Unit | ❌ | |
| 9.2 | Таб помечен на восстановление → discard не происходит | P1 | Unit | ❌ | |
| 9.3 | `openUnfocusedTabDiscarded=true` → новый фоновый таб сразу дискардится | P2 | E2E | ✅ | `unfocused-tab-discard.test.ts` |
| 9.4 | Уже discarded таб при активации — корректная навигация на park.html | P1 | E2E | ✅ | `discard-tab-id-change.test.ts` |

---

## 10. CTRL+CLICK ПРИОСТАНОВКА

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 10.1 | `suspendOnCtrlClick=true`, Ctrl+Click на ссылку → новый таб сразу приостанавливается | P2 | Unit | ✅ | `CtrlClickSuspend.test.ts` |
| 10.2 | Флаг `nextTabShouldBeSuspended` сбрасывается через 3 с, если таб не открылся | P2 | Unit | ✅ | `CtrlClickSuspend.test.ts` |
| 10.3 | Приостановка без скриншота при Ctrl+Click | P2 | Unit | ❌ | |

---

## 11. НАСТРОЙКИ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 11.1 | Экспорт настроек в JSON → корректный формат | P1 | Unit | ✅ | `SettingsExportImport.test.ts` |
| 11.2 | Импорт настроек из JSON → все поля применяются | P1 | Unit | ✅ | `SettingsExportImport.test.ts` |
| 11.3 | SettingsStore устойчив к повреждению chrome.storage | P1 | Unit | ✅ | `SettingsStore.Resilience.test.ts` |
| 11.4 | Изменение таймаута → TabObserver немедленно применяет новое значение | P1 | Unit | ❌ | |
| 11.5 | Валидация цвета фона: правильный hex / неправильный hex | P2 | Unit | ❌ | |
| 11.6 | Сброс настроек до дефолтных значений | P2 | Unit | ❌ | |
| 11.7 | Экспорт/импорт roundtrip без потери данных | P1 | Unit | ✅ | `BGMessageListener.ExportImport.test.ts` |

---

## 12. ХРАНИЛИЩЕ И БД

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 12.1 | IndexedDB инициализируется корректно, retry при ошибке | P1 | Unit | ✅ | `IndexedDBProvider.test.ts` |
| 12.2 | Скриншот сохраняется и читается без потерь | P1 | Unit | ✅ | `ScreenshotController.test.ts` |
| 12.3 | DBCleanup удаляет устаревшие записи (> 24 ч) | P2 | Unit | ✅ | `DBCleanup.test.ts` |
| 12.4 | Corrupt chrome.storage → расширение стартует без краша | P0 | E2E | ✅ | `corrupt-storage.test.ts` |
| 12.5 | TabInfo сжимается/распаковывается корректно при > 8 KB | P2 | Unit | ❌ | Chunked processing |
| 12.6 | Очистка данных формы через 60 с | P2 | Unit | ❌ | |
| 12.7 | История приостановок ограничена 300 записями (LIFO) | P3 | Unit | ❌ | |

---

## 13. TAB MANAGER И ЗАМЕНА ID

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 13.1 | Поиск TabInfo по replaced tab ID (onReplaced event) | P1 | Unit | ✅ | `TabManager.test.ts` |
| 13.2 | Цепочка замен IDs отслеживается корректно | P2 | Unit | ✅ | `TabManager.test.ts` |
| 13.3 | Интеграция: TabManager + приостановка + замена ID | P1 | Unit | ✅ | `TabManagerIntegration.test.ts` |
| 13.4 | Discard меняет ID таба → данные не теряются, restore работает | P1 | E2E | ✅ | `discard-tab-id-change.test.ts` |

---

## 14. ЗАХВАТ ЭКРАНА (TabCapture)

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 14.1 | Захват выполняется при активации таба (`status === 'complete'`) | P1 | Unit | ✅ | `TabCapture.test.ts` |
| 14.2 | Ошибка квоты MAX_CAPTURE_CALLS → retry до 3 раз | P2 | Unit | ❌ | |
| 14.3 | chrome:// страница → ошибка поймана, приостановка не ломается | P2 | Unit | ❌ | |
| 14.4 | Таб закрыт во время захвата → нет unhandled exception | P2 | Unit | ❌ | |

---

## 15. СТАРТ И СЕССИЯ БРАУЗЕРА

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 15.1 | `restoreTabOnStartup=true` → приостановленные табы восстанавливаются при старте | P1 | E2E | ❌ | Функция не реализована в расширении (код закомментирован) |
| 15.2 | `startDiscarted=true` → приостановленные табы при старте сразу в discard | P2 | E2E | ✅ | `start-discarded.test.ts` (settings path + discard handler) |
| 15.3 | Session ID сохраняется и читается после перезапуска браузера | P2 | Unit | ❌ | |
| 15.4 | Сгруппированные табы восстанавливаются до обработки сессии | P2 | Unit | ✅ | `GroupRestoreFix.test.ts` |

---

## 16. HEARTBEAT И SERVICE WORKER

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 16.1 | Offscreen document отправляет heartbeat каждые 20 с | P2 | Unit | ❌ | Keepalive |
| 16.2 | Service worker не засыпает при активной работе | P2 | E2E | ❌ | |

---

## 17. КЛАВИАТУРНЫЕ КОМАНДЫ И КОНТЕКСТНОЕ МЕНЮ

| # | Тест-кейс | Приоритет | Тип | Статус | Примечание |
|---|-----------|-----------|-----|--------|------------|
| 17.1 | "Suspend Current Tab" приостанавливает активный таб | P1 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase C |
| 17.2 | "Suspend All Other Tabs" приостанавливает все кроме текущего | P1 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase A |
| 17.3 | "Unsuspend Current Window" восстанавливает все в окне | P1 | E2E | ✅ | `bulk-tab-operations.test.ts` Phase B |
| 17.4 | "Add to Whitelist" из меню сохраняет паттерн и синхронизирует иконку | P2 | E2E | ✅ | `whitelist-ignore.test.ts` (underlying API) |
| 17.5 | Иконка расширения меняется: normal / off / paused / whitelisted / ignored | P2 | E2E | ❌ | |

---

## СВОДНАЯ СТАТИСТИКА

| Приоритет | Всего | Покрыто ✅ | Частично ⚠️ | Не покрыто ❌ |
|-----------|-------|-----------|------------|--------------|
| P0 (критично) | 13 | 13 | 0 | 0 |
| P1 (высокий) | 47 | 38 | 0 | 9 |
| P2 (средний) | 40 | 19 | 1 | 20 |
| P3 (низкий) | 3 | 0 | 0 | 3 |
| **Итого** | **103** | **70 (68%)** | **1 (1%)** | **32 (31%)** |

---

## Puppeteer-тесты (файлы)

| Файл | Покрывает тест-кейсы | Статус |
|------|---------------------|--------|
| `basic-suspend-restore.test.ts` | 1.1, 2.1 | ✅ |
| `auto-restore-tab.test.ts` | 2.2 | ✅ |
| `restore-modes.test.ts` | 2.3, 2.4 | ✅ |
| `form-data-restore.test.ts` | 2.8 | ✅ |
| `protected-urls.test.ts` | 3.8 | ✅ |
| `whitelist-ignore.test.ts` | 3.4, 3.5, 3.9, 17.4 | ✅ |
| `favicon-loss.test.ts` | 4.1, 4.2, 4.3 | ✅ |
| `favicon-nav-stress.test.ts` | 4.4 | ✅ |
| `screenshot-settings.test.ts` | 4.5, 4.6 | ✅ |
| `discard-tab-id-change.test.ts` | 9.4, 13.4 | ✅ |
| `unfocused-tab-discard.test.ts` | 9.3 | ✅ |
| `corrupt-storage.test.ts` | 12.4 | ✅ |
| `start-discarded.test.ts` | 15.2 | ✅ |
| `bulk-tab-operations.test.ts` | 17.1, 17.2, 17.3 | ✅ |
| `adaptive-timeout.test.ts` | 1.8 | ✅ |
| `pinned-tab-protection.test.ts` | 5.1, 5.2 | ✅ |
| `hover-restore.test.ts` | 2.6 | ✅ |
| `url-param-preserve.test.ts` | 2.9 | ✅ |

## Jest-тесты (файлы)

| Файл | Покрывает тест-кейсы | Статус |
|------|---------------------|--------|
| `TabObserver.AutoSuspension.test.ts` | 1.2, 1.3, 1.4, 1.6, 1.7, 1.9, 1.10 | ✅ |
| `TabObserver.ActiveDisabled.test.ts` | 1.5 | ✅ |
| `WhiteList.test.ts` | 3.1, 3.2, 3.3, 3.6, 3.7 | ✅ |
| `GroupRestoreFix.test.ts` | 15.4 | ✅ |
| `SettingsExportImport.test.ts` | 11.2 | ✅ |
| `SettingsStore.Resilience.test.ts` | 11.3 | ✅ |
| `BGMessageListener.ExportImport.test.ts` | 11.7 | ✅ |
| `TabRestore.test.ts` | 2.5, 2.7 | ✅ |
