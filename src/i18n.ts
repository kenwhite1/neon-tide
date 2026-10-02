import { resolveGameLanguage } from './gameLocale'
// Синхронизация языка с хабом Game is Game (см. GG/SDK.md, §i18n):
// 1) claim `lng` из токена запуска (start_param) - хаб знает лучше;
// 2) сохранённый выбор (localStorage);
// 3) язык Telegram-клиента;
// 4) русский по умолчанию.
//
// t(ru) переводит короткую строку по русскому ключу; L(ru, en) выбирает целый
// блок данных (каталоги блоков, квесты). Язык решается один раз на запуск -
// переключателя внутри игры нет, его роль играет тумблер в хабе.


export type Lang = 'ru' | 'en';

const KEY = 'gg_lang';

function detectLang(): Lang { return resolveGameLanguage(KEY) }

export const lang: Lang = detectLang();

/** Выбрать блок данных по языку. */
export function L<T>(ru: T, en: T): T {
  return lang === 'ru' ? ru : en;
}

const EN: Record<string, string> = {
  // приглашение друзей из хаба
  'Заходи ко мне в Кораблик!': 'Come build a boat with me!',
  'ЛЁГКИЙ': 'EASY',
  'СРЕДНИЙ': 'MEDIUM',
  'СЛОЖНЫЙ': 'HARD',
  'Дерево': 'Wood',
  'Дёшево, отлично плавает, быстро ломается': 'Cheap, floats beautifully, breaks fast',
  'Пластик': 'Plastic',
  'Лёгкий и скользкий': 'Light and slippery',
  'Металл': 'Metal',
  'Броня - тонет без корпуса': 'Armour, sinks without a hull',
  'Золото': 'Gold',
  'Тяжёлое, блестит, почти не ломается': 'Heavy, shiny, almost unbreakable',
  'Сиденье': 'Seat',
  'Здесь едет твой капитан': 'This is where your captain rides',
  'Руль': 'Rudder',
  '+ управляемость': '+ handling',
  'Двигатель': 'Thruster',
  'Рывок скорости, есть перезарядка': 'A burst of speed, with a cooldown',
  'Шар': 'Balloon',
  'Подъём! Легко лопается': 'Lift! Pops easily',
  'Динамит': 'Dynamite',
  'Взрывается от сильного удара': 'Explodes on a hard hit',
  'Дойти до этапа 5': 'Reach stage 5',
  'Пройти заплыв - только дерево и сиденье': 'Finish a run with wood and a seat only',
  'Пережить водопад': 'Survive the waterfall',
  'Кораблик - построй лодку за сокровищем': 'Boatyard - build a boat, chase the treasure',

  // boot / shell
  'КОРАБ': 'BOAT',
  'ЛИК': 'YARD',
  'построй лодку · пройди пороги · забери золото': 'build a boat · run the rapids · grab the gold',
  'ЗАГРУЗКА…': 'LOADING…',
  'ОТПЛЫТЬ ▶': 'SET SAIL ▶',
  'дерево плавает - золото нет. удачи, капитан.': 'wood floats, gold does not. good luck, captain.',

  // build HUD
  'отменить': 'undo',
  'повернуть': 'rotate',
  'режим удаления': 'delete mode',
  'СТАРТ ▶': 'START ▶',
  'ПРИЧАЛ': 'DOCK',
  'ЭТАП': 'STAGE',
  'ФИНИШ': 'FINISH',
  'КВЕСТЫ': 'QUESTS',
  'КВЕСТ': 'QUEST',
  'золота': 'gold',
  'прочность': 'durability',
  'стоит': 'costs',

  // sail controls
  'ПРЫЖОК': 'JUMP',
  'БУСТ': 'BOOST',
  'ВПЕРЁД!': 'GO!',

  // run outcomes
  'Лодка раскололась! Летим за сиденьем': 'The boat split! Riding the seat now',
  'Перепрыгнул на другое сиденье!': 'Hopped onto another seat!',
  'Нет двигателей на борту': 'No thrusters on board',
  'Возврат в порт': 'Back to port',
  '🌊 Пережил водопад!': '🌊 Survived the waterfall!',
  'Сиденье уничтожено': 'Seat destroyed',
  'Капитан ушёл под воду': 'The captain went under',
  'Застрял - нет хода': 'Stuck - no way forward',
  'Пропал в пучине': 'Lost in the deep',
  'Сокровище забрано!': 'Treasure claimed!',

  // results modal
  '🏆 ЗАПЛЫВ ПРОЙДЕН!': '🏆 RUN COMPLETE!',
  'КРУШЕНИЕ': 'WRECKED',
  'Дошёл до этапа': 'Reached stage',
  'Золота получено': 'Gold earned',
  'Время заплыва': 'Run time',
  'Потеряно блоков': 'Blocks lost',
  'Лучший этап': 'Best stage',
  'ПЕРЕСОБРАТЬ И ЗАПУСК': 'REBUILD AND LAUNCH',

  // treasure modal
  'СОКРОВИЩЕ!': 'TREASURE!',
  'Сундук со скрипом открывается…': 'The chest creaks open…',
  'ЗАБРАТЬ': 'COLLECT',
  'ЗОЛОТА': 'GOLD',

  // help modal
  'КАК ИГРАТЬ': 'HOW TO PLAY',
  'СТРОЙКА': 'BUILDING',
  'Коснись, чтобы поставить блок. Веди пальцем - вращать камеру, щипок - зум. ✕ - режим удаления. ⟳ - поворот сидений и двигателей. Блоки стоят золота, при удалении оно возвращается.':
    'Tap to place a block. Drag to orbit the camera, pinch to zoom. ✕ is delete mode. ⟳ rotates seats and thrusters. Blocks cost gold; deleting refunds it.',
  'ЗАПЛЫВ': 'THE RUN',
  'Течение несёт тебя вперёд. Джойстик (или A/D) рулит, БУСТ включает двигатели (W), ПРЫЖОК подскакивает (пробел). Доберись до ФИНИША за сокровищем - золото копится за каждый этап, даже если разобьёшься.':
    'The current carries you forward. The stick (or A/D) steers, BOOST fires the thrusters (W), JUMP hops (space). Reach the FINISH for the treasure - gold accrues per stage even if you wreck.',
  'Дерево плавает · металл и золото тонут без корпуса · шары поднимают · динамит - ужасная, чудесная идея.':
    'Wood floats · metal and gold sink without a hull · balloons lift · dynamite is a terrible, wonderful idea.',
  'ПОНЯТНО': 'GOT IT',

  // settings modal
  'НАСТРОЙКИ': 'SETTINGS',
  'Цвет команды': 'Crew colour',
  'Звук': 'Sound',
  'ВЫКЛ': 'OFF',
  'ВКЛ': 'ON',
  'Поделиться лодкой': 'Share the boat',
  'ССЫЛКА': 'LINK',
  'Очистить участок': 'Clear the plot',
  'ОЧИСТИТЬ': 'CLEAR',
  'ГОТОВО': 'DONE',

  // toasts / rooms
  'Запускать может только хост - попроси его!': 'Only the host can launch - go ask them!',
  'Участок очищен - блоки возвращены': 'Plot cleared - blocks refunded',
  '⚓ Моя лодка в Кораблике - загрузи и побей мой заплыв!': '⚓ My boat in Boatyard - load it and beat my run!',
  'Окно «Поделиться» открыто': 'Share sheet opened',
  'Ссылка скопирована в буфер': 'Link copied to clipboard',
  'Лодка загружена': 'Boat loaded',
  'блоков': 'blocks',
  'пропущено (не хватило золота)': 'skipped (not enough gold)',
  'Комната': 'Room',
  'ХОСТ': 'HOST',
  'в команде': 'in the crew',
  'Команда': 'Crew',
  'Вышел из комнаты - снова соло': 'Left the room - solo again',
  'Мультиплеер': 'Multiplayer',
  'СОЗДАТЬ': 'CREATE',
  'ВОЙТИ': 'JOIN',
  'КОД': 'CODE',
  'ОК': 'OK',
  'ПРИГЛАСИТЬ': 'INVITE',
  'ВЫЙТИ': 'LEAVE',
  'Заходи в мою команду в Кораблике! Код комнаты:': 'Join my crew in Boatyard! Room code:',
  'Окно приглашения открыто': 'Invite sheet opened',
  'Ссылка-приглашение скопирована': 'Invite link copied',
};

/** Перевод короткой строки: русский текст и есть ключ. */
export function t(ru: string): string {
  return lang === 'ru' ? ru : (EN[ru] ?? ru);
}
