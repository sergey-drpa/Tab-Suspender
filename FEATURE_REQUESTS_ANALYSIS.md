# Анализ Feature Requests - Tab Suspender

**Дата анализа:** 2025-12-11
**Всего запросов:** 37
**Источник:** Support Tickets из Developer Console

---

## Высокий приоритет (критично для UX)

### 1. Allow MANUAL suspend on whitelisted tabs
**Значимость:** ⭐⭐⭐⭐⭐
**От:** Edouard Lorenceau | **Дата:** 2025-07-14 | **Версия:** 2.0.6

**Суть:** Whitelist должен блокировать только AUTO-suspend, но не MANUAL suspend.

**Описание:**
> It's nice to have a whitelist, but to me its only purpose is to whitelist tabs from being AUTO-suspended! If the whitelist prevents me from MANUALLY closing a tab as well then the whitelist is pointless!

**Рекомендация:** Добавить toggle в настройках whitelist: "Allow manual suspend on whitelisted tabs" (включён по умолчанию). Применить ту же логику к "ignore audible tabs" и "ignore pinned tabs".

---

### 2. Persistent Whitelist on update
**Значимость:** ⭐⭐⭐⭐⭐
**От:** jata zoulja | **Дата:** 2025-01-09 | **Версия:** 1.4.12

**Суть:** Whitelist сбрасывается при обновлении расширения.

**Описание:**
> Can we persist whitelisted website on update? Seems like everytime the extension update I have to whitelist all the sites again.

**Рекомендация:** Проверить механизм сохранения настроек. Возможно баг в миграции данных между версиями. Критично для retention пользователей.

---

### 3. Not suspend tabs with unsaved input
**Значимость:** ⭐⭐⭐⭐⭐
**От:** Vedrana Novosel | **Дата:** 2021-04-06 | **Версия:** 1.4.1

**Суть:** Добавить опцию не suspend'ить вкладки с несохранённым вводом в формах.

**Описание:**
> Please add an option to not suspend tabs that have text actively inputted into an input box. I have lost multiple works in progress due to tab suspender closing my tabs without regard to inputs.

**Рекомендация:** Детектировать input/textarea с введённым текстом перед suspend. Добавить toggle "Don't suspend tabs with unsaved form data".

---

### 4. Optional screenshot (disable screenshots)
**Значимость:** ⭐⭐⭐⭐⭐
**От:** Xan Krigor | **Дата:** 2020-03-07 | **Версия:** 1.3.7

**Суть:** Возможность полностью отключить скриншоты suspended страниц.

**Описание:**
> Can you make screenshot for page optional? I have a lot of tabs and want to discard them as much as I can and want also remove screenshots. Right now I set their quality at 10%, but it still too much, I have 16 GB RAM and Chrome consume 12+ GB of it, even when about 80% tabs are suspended.

**Рекомендация:** Добавить toggle "Disable screenshots" или опцию quality=0. Скриншоты занимают значительную память при большом количестве вкладок.

---

## Средний-высокий приоритет (улучшает продукт)

### 5. Right-click context menu for suspend
**Значимость:** ⭐⭐⭐⭐
**От:** Andrew Chapman | **Дата:** 2021-12-23 | **Версия:** 1.4.10

**Суть:** Suspend вкладки через контекстное меню правой кнопки мыши.

**Описание:**
> Would be great if we could right-click a tab and suspend it from the popup menu there. That seems more in line with tab UX than bringing the tab to the front, and suspending it via the extension.

**Рекомендация:** Использовать chrome.contextMenus API для добавления пунктов "Suspend this tab" / "Suspend other tabs" в контекстное меню вкладки.

---

### 6. Searchable suspended tabs
**Значимость:** ⭐⭐⭐⭐
**От:** Josh Dobbin | **Дата:** 2022-08-25 | **Версия:** 1.4.11

**Суть:** Suspended вкладки не находятся через Chrome "Search Tabs" (Ctrl+Shift+A).

**Описание:**
> When a tab has been suspended, it no longer includes some of the same information that made it searchable with the "Search Tabs" feature. Can I suggest changing it a little to make tabs more searchable? Things like the URL and Title would be the main searchable things.

**Рекомендация:** Сохранять оригинальный title в свойствах suspended вкладки для поиска Chrome.

---

### 7. Display website title in suspended tab
**Значимость:** ⭐⭐⭐⭐
**От:** Jochem Huhmann | **Дата:** 2021-10-26 | **Версия:** 1.4.8

**Суть:** Показывать title страницы на suspended вкладке, не только URL.

**Описание:**
> Could you add a second line on the top with the title of the page additionally to the URL? Most of the time I'm looking at the URL to make sure I've selected the tab I wanted, but the title would be just way more user friendly for that.

**Рекомендация:** Добавить отображение title под URL на suspended странице.

---

### 8. Show original URL at page top
**Значимость:** ⭐⭐⭐⭐
**От:** Jegoopv Alekc | **Дата:** 2021-11-30 | **Версия:** 1.4.10

**Суть:** Показывать оригинальный URL сразу, без необходимости нажимать "info".

**Описание:**
> To see original page URL immediately at the page top as it was some time ago - is best solution, necessity to press "info" button to unhide it is too boring...

**Рекомендация:** Восстановить предыдущее поведение - URL виден сразу. Это была регрессия UX.

---

### 9. Suspend tabs by memory/CPU usage
**Значимость:** ⭐⭐⭐⭐
**От:** Brad Templeton | **Дата:** 2020-03-30 | **Версия:** 1.3.7

**Суть:** Suspend'ить вкладки по потреблению памяти/CPU, а не только по времени.

**Описание:**
> Rather than simply suspending based on idle time, perhaps it makes sense to suspend tabs that are using particularly large amounts of memory, or which are sucking CPU. After all, that's the reason we want to suspend tabs. And to counter that, there is little to be gained from suspending tabs with small footprints.

**Рекомендация:** Использовать chrome.processes API (если доступен) для мониторинга ресурсов. Умный suspend тяжёлых вкладок.

---

### 10. Garbage collector for old suspended data
**Значимость:** ⭐⭐⭐⭐
**От:** João Carlos Mendes Luís | **Дата:** 2023-09-01 | **Версия:** 1.4.11

**Суть:** Расширение оставляет "мусор" от закрытых suspended вкладок.

**Описание:**
> It seems to me and many other commenters that the extension leaves garbage after some time. Probably context from old suspended tabs that have been closed before unsuspend. Is it possible to create a Garbage Collector Runner analyzer/button?

**Рекомендация:** Добавить кнопку "Clean up old data" в настройках. Периодически чистить данные вкладок которых больше нет.

---

### 11. Русский язык (локализация)
**Значимость:** ⭐⭐⭐⭐
**От:** Борис Буханов | **Дата:** 2021-09-18 | **Версия:** 1.4.8

**Суть:** Добавить русскую локализацию интерфейса.

**Описание:**
> Добавьте пожалуйста русский язык чтобы меню и настройки были на русском.

**Рекомендация:** Использовать chrome.i18n API. Создать _locales/ru/messages.json.

---

### 12. Dark mode
**Значимость:** ⭐⭐⭐⭐
**От:** bob f | **Дата:** 2021-04-14 | **Версия:** 1.4.1

**Суть:** Тёмная тема для settings и popup меню.

**Описание:**
> Dark mode for settings window and menu.

**Рекомендация:** Использовать CSS переменные и prefers-color-scheme media query. Или добавить toggle в настройках.

---

## Средний приоритет (nice to have)

### 13. Autoclose list
**Значимость:** ⭐⭐⭐
**От:** Sláva Mrvka | **Дата:** 2024-02-01 | **Версия:** 1.4.12

**Суть:** Список сайтов для автоматического закрытия вместо suspend.

**Описание:**
> Add function of a list of webs which will be autoclosed in a particular time. Example: open speedtest.net, forget to close - autoclose in 2 minutes instead of suspending.

**Рекомендация:** Интересная идея, но выходит за основной scope. Можно реализовать как отдельную фичу.

---

### 14. Auto-suspend active tabs (multi-desktop)
**Значимость:** ⭐⭐⭐
**От:** Jegoopv Alekc | **Дата:** 2021-08-29 | **Версия:** 1.4.8

**Суть:** Возможность suspend'ить активные вкладки в неиспользуемых окнах.

**Описание:**
> I use multiple desktops and multiple chrome windows, so it would be great to have ability to auto-suspend active tabs on those windows that I don't use long time too.

**Рекомендация:** Добавить опцию "Suspend active tab in inactive windows after X minutes".

---

### 15. First tab in fullscreen won't suspend (macOS)
**Значимость:** ⭐⭐⭐
**От:** Dean Chen | **Дата:** 2021-11-19 | **Версия:** 1.4.10

**Суть:** На macOS первая вкладка в fullscreen режиме не suspend'ится автоматически.

**Рекомендация:** Исследовать edge case для macOS fullscreen/split-screen режимов.

---

### 16. Longer suspend times (24h, 3 days)
**Значимость:** ⭐⭐⭐
**От:** Gustavo Rivera | **Дата:** 2020-06-07 | **Версия:** 1.3.8

**Суть:** Добавить более длинные интервалы для suspend (24 часа, 3 дня).

**Рекомендация:** Расширить dropdown с временными интервалами.

---

### 17. Retain favicon when suspended
**Значимость:** ⭐⭐⭐
**От:** Comdex | **Дата:** 2021-03-01 | **Версия:** 1.4.1

**Суть:** Сохранять оригинальную иконку сайта на suspended вкладке.

**Рекомендация:** Кэшировать favicon и показывать вместо иконки расширения.

---

### 18. Confirm "unsuspend all"
**Значимость:** ⭐⭐⭐
**От:** ItaloRaver | **Дата:** 2020-06-08 | **Версия:** 1.3.8

**Суть:** Запрашивать подтверждение перед "unsuspend all tabs".

**Описание:**
> If you accidentally click unsuspend all tabs with many tabs it can be very annoying. A confirmation for functions that affect many tabs would be good.

**Рекомендация:** Добавить confirm dialog для массовых операций.

---

### 19. Suspend local HTML files
**Значимость:** ⭐⭐⭐
**От:** Benjamin Schäfer | **Дата:** 2021-07-07 | **Версия:** 1.4.6

**Суть:** Поддержка suspend для file:// URL.

**Рекомендация:** Для веб-разработчиков полезно. Требует дополнительных permissions.

---

### 20. Sync suspended tabs with phone bookmarks
**Значимость:** ⭐⭐⭐
**От:** Anatolii Bakhtin | **Дата:** 2022-09-28 | **Версия:** 1.4.11

**Суть:** Возможность сохранить suspended tabs как bookmarks без unsuspend.

**Рекомендация:** Добавить опцию "Export suspended tabs as bookmarks".

---

## Низкий приоритет (специфичные случаи)

| # | Запрос | От | Дата | Причина низкого приоритета |
|---|--------|-----|------|---------------------------|
| 21 | WebSQL deprecation fix | Adrian Staicu | 2023-11-14 | Уже исправлено в v2.0 |
| 22 | Уменьшить размер расширения | BatMan The | 2022-12-14 | 2.3MB не критично |
| 23 | Tab hover previews (Brave) | creon levit | 2021-11-23 | Браузер-специфичная фича |
| 24 | Font size in dropdown | Jack Zehring | 2021-06-22 | Очень специфичный случай |
| 25 | Maintain screenshot timestamp | Arnold Saenz | 2021-05-04 | Узкий use case |
| 26 | Hard refresh option | Arnold Saenz | 2020-10-02 | Edge case |
| 27 | Restore with maximized windows | Konrád Lőrinczi | 2020-09-13 | Специфичный случай |
| 28 | favicon.ico 404 errors | Vittorio Zamparella | 2020-05-11 | Косметический баг |
| 29 | Admin lock settings (RDS) | Alan Thorpe | 2020-02-27 | Корпоративный use case |
| 30 | Firefox version | Konrád Lőrinczi | 2020-02-17 | Требует полного портирования |
| 31 | Bigger intro screenshots | Jason Howard | 2019-11-16 | Минорное |
| 32 | Discard disabled by default | Konrád Lőrinczi | 2019-08-12 | Вопрос defaults |
| 33 | "Graveyard" tab concept | None | 2018-10-06 | Интересно, но сложно |

---

## Игнорировать

| # | Запрос | Причина |
|---|--------|---------|
| Auto-restore working | Благодарность за фикс, не feature request |
| Make money (monetization) | Спам от 2016 года |

---

## Рекомендуемый план реализации

### Фаза 1: Must-Have (критично)
1. **Whitelist только для auto-suspend** - изменить логику, добавить toggle
2. **Сохранение настроек при обновлении** - исправить если баг
3. **Защита форм с несохранённым вводом** - детектировать input fields
4. **Опция отключения скриншотов** - toggle "Disable screenshots"

### Фаза 2: Should-Have (улучшения)
5. **Контекстное меню** - chrome.contextMenus API
6. **Русская локализация** - chrome.i18n
7. **Dark mode** - CSS variables + prefers-color-scheme
8. **Показывать title на suspended странице**

### Фаза 3: Could-Have (если время позволяет)
9. **Suspend по memory usage** - chrome.processes API
10. **Searchable suspended tabs** - сохранять метаданные
11. **Garbage collector** - очистка старых данных
12. **Сохранять favicon suspended вкладок**

---

## Статистика по категориям

| Категория | Количество |
|-----------|------------|
| UX улучшения | 12 |
| Настройки/опции | 8 |
| Performance | 4 |
| Визуальное оформление | 5 |
| Локализация | 1 |
| Интеграции | 3 |
| Специфичные случаи | 4 |
