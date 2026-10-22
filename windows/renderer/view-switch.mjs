export function confirmViewSwitch(recordings,confirm){
 const count=[...recordings].filter(r=>['choosing','recording','stopping'].includes(r.state)).length;
 return !count||confirm(`Переключение просмотра завершит текущие записи (${count}). Записанные данные будут сохранены; для продолжения потребуется начать новую запись. Переключить просмотр?`);
}
