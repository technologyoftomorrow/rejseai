import { TZDate } from '@date-fns/tz';
import { format, subDays } from 'date-fns';
import { da } from 'date-fns/locale';

export class DanishTimeHandler {
  constructor() {
    this.timezone = 'Europe/Copenhagen';
  }

  getCurrentDanishTime() {
    // Træk dage fra den aktuelle dato
    const yesterday = subDays(new Date(), 7);
    const danishTime = new TZDate(yesterday, this.timezone);
    
    return format(danishTime, "yyyy-MM-dd'T'HH:mm:ssXXX", {
      locale: da
    });
  }

  formatForDisplay() {
    // Træk en dag fra den aktuelle dato
    const fixedDay = subDays(new Date(), 1);
    const danishTime = new TZDate(fixedDay, this.timezone);
    
    return format(danishTime, 'dd.MM.yyyy HH:mm', {
      locale: da
    });
  }
}