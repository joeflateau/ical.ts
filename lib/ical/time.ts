/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { Timezone } from './timezone';
import { Duration } from './duration';
import { design } from './design';
import { TimezoneService } from './timezone_service';
import { pad2, strictParseInt, trunc } from './helpers';
import type { Property } from './property';

interface TimeData {
  /** The year for this date */
  year?: number;
  /** The month for this date */
  month?: number;
  /** The day for this date */
  day?: number;
  /** The hour for this date */
  hour?: number;
  /** The minute for this date */
  minute?: number;
  /** The second for this date */
  second?: number;
  /** If true, the instance represents a date (as opposed to a date-time) */
  isDate?: boolean;
  /** Timezone this position occurs in */
  aZone?: Timezone;
}

/**
 * The weekday, 1 = SUNDAY, 7 = SATURDAY. Access via
 * ICAL.Time.MONDAY, ICAL.Time.TUESDAY, ...
 */
export enum WeekDay {
  SUNDAY = 1,
  MONDAY = 2,
  TUESDAY = 3,
  WEDNESDAY = 4,
  THURSDAY = 5,
  FRIDAY = 6,
  SATURDAY = 7
}

/**
 * @classdesc
 * iCalendar Time representation (similar to JS Date object).  Fully
 * independent of system (OS) timezone / time.  Unlike JS Date, the month
 * January is 1, not zero.
 *
 * @example
 * var time = new ICAL.Time({
 *   year: 2012,
 *   month: 10,
 *   day: 11
 *   minute: 0,
 *   second: 0,
 *   isDate: false
 * });
 *
 *
 * @alias ICAL.Time
 * @class
 */
export class Time {
  wrappedJSObject: Time;

  static _dowCache: Record<number, number> = {};
  static _wnCache: Record<number, number> = {};

  protected _time: Required<TimeData>;
  private auto_normalize: boolean;

  year!: number;
  month!: number;
  day!: number;
  hour!: number;
  minute!: number;
  second!: number;
  isDate!: boolean;

  /**
   * Returns the days in the given month
   *
   * @param {Number} month      The month to check
   * @param {Number} year       The year to check
   * @return {Number}           The number of days in the month
   */
  static daysInMonth(month: number, year: number): number {
    const _daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let days = 30;

    if (month < 1 || month > 12) return days;

    days = _daysInMonth[month];

    if (month === 2) {
      days += Time.isLeapYear(year) ? 1 : 0;
    }

    return days;
  }

  /**
   * Checks if the year is a leap year
   *
   * @param year The year to check
   * @return True, if the year is a leap year
   */
  static isLeapYear(year: number): boolean {
    if (year <= 1752) {
      return year % 4 === 0;
    } else {
      return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    }
  }

  /**
   * Create a new ICAL.Time from the day of year and year. The date is returned
   * in floating timezone.
   *
   * @param aDayOfYear The day of year
   * @param aYear      The year to create the instance in
   * @return           The created instance with the calculated date
   */
  static fromDayOfYear(aDayOfYear: number, aYear: number): Time {
    let year = aYear;
    let doy = aDayOfYear;
    const tt = new Time();
    tt.auto_normalize = false;
    let is_leap = Time.isLeapYear(year) ? 1 : 0;

    if (doy < 1) {
      year--;
      is_leap = Time.isLeapYear(year) ? 1 : 0;
      doy += Time.daysInYearPassedMonth[is_leap][12];
      return Time.fromDayOfYear(doy, year);
    } else if (doy > Time.daysInYearPassedMonth[is_leap][12]) {
      is_leap = Time.isLeapYear(year) ? 1 : 0;
      doy -= Time.daysInYearPassedMonth[is_leap][12];
      year++;
      return Time.fromDayOfYear(doy, year);
    }

    tt.year = year;
    tt.isDate = true;

    for (let month = 11; month >= 0; month--) {
      if (doy > Time.daysInYearPassedMonth[is_leap][month]) {
        tt.month = month + 1;
        tt.day = doy - Time.daysInYearPassedMonth[is_leap][month];
        break;
      }
    }

    tt.auto_normalize = true;
    return tt;
  }

  /**
   * Returns a new ICAL.Time instance from a date string, e.g 2015-01-02.
   *
   * @deprecated Use {@link ICAL.Time.fromDateString} instead
   * @param str  The string to create from
   * @return     The date/time instance
   */
  static fromStringv2(str: string): Time {
    return new Time({
      year: parseInt(str.slice(0, 4), 10),
      month: parseInt(str.slice(5, 7), 10),
      day: parseInt(str.slice(8, 10), 10),
      isDate: true
    });
  }

  /**
   * Returns a new ICAL.Time instance from a date string, e.g 2015-01-02.
   *
   * @param aValue The string to create from
   * @return       The date/time instance
   */
  static fromDateString(aValue: string): Time {
    // Dates should have no timezone.
    // Google likes to sometimes specify Z on dates
    // we specifically ignore that to avoid issues.

    // YYYY-MM-DD
    // 2012-10-10
    return new Time({
      year: strictParseInt(aValue.slice(0, 4)),
      month: strictParseInt(aValue.slice(5, 7)),
      day: strictParseInt(aValue.slice(8, 10)),
      isDate: true
    });
  }

  /**
   * Returns a new ICAL.Time instance from a date-time string, e.g
   * 2015-01-02T03:04:05. If a property is specified, the timezone is set up
   * from the property's TZID parameter.
   *
   * @param aValue The string to create from
   * @param prop   The property the date belongs to
   * @return       The date/time instance
   */
  static fromDateTimeString(aValue: string, prop?: Property): Time {
    if (aValue.length < 19) {
      throw new Error('invalid date-time value: "' + aValue + '"');
    }

    let zone;
    let zoneId;

    if (aValue[19] && aValue[19] === 'Z') {
      zone = Timezone.utcTimezone;
    } else if (prop) {
      zoneId = prop.getParameter('tzid');

      if (prop.parent) {
        if (
          prop.parent.name === 'standard' ||
          prop.parent.name === 'daylight'
        ) {
          // Per RFC 5545 3.8.2.4 and 3.8.2.2, start/end date-times within
          // these components MUST be specified in local time.
          zone = undefined;
        } else if (zoneId) {
          // If the desired time zone is defined within the component tree,
          // fetch its definition and prefer that.
          zone = prop.parent.getTimeZoneByID(zoneId);
        }
      }
    }

    const timeData = {
      year: strictParseInt(aValue.slice(0, 4)),
      month: strictParseInt(aValue.slice(5, 7)),
      day: strictParseInt(aValue.slice(8, 10)),
      hour: strictParseInt(aValue.slice(11, 13)),
      minute: strictParseInt(aValue.slice(14, 16)),
      second: strictParseInt(aValue.slice(17, 19))
    };

    // Although RFC 5545 requires that all TZIDs used within a file have a
    // corresponding time zone definition, we may not be parsing the full file
    // or we may be dealing with a non-compliant file; in either case, we can
    // check our own time zone service for the TZID in a last-ditch effort.
    if (zoneId && !zone) {
      timeData.timezone = zoneId;
    }

    // 2012-10-10T10:10:10(Z)?
    return new Time(timeData, zone);
  }

  /**
   * Returns a new ICAL.Time instance from a date or date-time string,
   *
   * @param aValue    The string to create from
   * @param aProperty The property the date belongs to
   * @return          The date/time instance
   */
  static fromString(aValue: string, aProperty?: Property): Time {
    if (aValue.length > 10) {
      return Time.fromDateTimeString(aValue, aProperty);
    } else {
      return Time.fromDateString(aValue);
    }
  }

  /**
   * Creates a new ICAL.Time instance from the given Javascript Date.
   *
   * @param aDate     The Javascript Date to read, or null to reset
   * @param {Boolean} useUTC  If true, the UTC values of the date will be used
   */
  static fromJSDate(aDate: Date | null, useUTC: boolean) {
    const tt = new Time();
    return tt.fromJSDate(aDate, useUTC);
  }

  /**
   * Creates a new ICAL.Time instance from the the passed data object.
   *
   * @param aData Time initialization
   * @param aZone Timezone this position occurs in
   */
  static fromData = function fromData(aData: TimeData, aZone?: Timezone) {
    const t = new Time();
    return t.fromData(aData, aZone);
  };

  /**
   * Creates a new ICAL.Time instance from the current moment.
   * The instance is “floating” - has no timezone relation.
   * To create an instance considering the time zone, call
   * ICAL.Time.fromJSDate(new Date(), true)
   */
  static now(): Time {
    return Time.fromJSDate(new Date(), false);
  }

  /**
   * Returns the date on which ISO week number 1 starts.
   *
   * @see ICAL.Time#weekNumber
   * @param {Number} aYear                  The year to search in
   * @param {Time.weekDay=} aWeekStart The week start weekday, used for calculation.
   * @return {Time}                    The date on which week number 1 starts
   */
  static weekOneStarts(aYear: number, aWeekStart: WeekDay): Time {
    const t = Time.fromData({
      year: aYear,
      month: 1,
      day: 1,
      isDate: true
    });

    const dow = t.dayOfWeek();
    const wkst = aWeekStart || Time.DEFAULT_WEEK_START;
    if (dow > Time.THURSDAY) {
      t.day += 7;
    }
    if (wkst > Time.THURSDAY) {
      t.day -= 7;
    }

    t.day -= dow - wkst;

    return t;
  }

  /**
   * Get the dominical letter for the given year. Letters range from A - G for
   * common years, and AG to GF for leap years.
   *
   * @param {Number} yr           The year to retrieve the letter for
   * @return {String}             The dominical letter.
   */
  static getDominicalLetter(yr: number): string {
    const LTRS = 'GFEDCBA';
    const dom =
      (yr + ((yr / 4) | 0) + ((yr / 400) | 0) - ((yr / 100) | 0) - 1) % 7;
    const isLeap = Time.isLeapYear(yr);
    if (isLeap) {
      return LTRS[(dom + 6) % 7] + LTRS[dom];
    } else {
      return LTRS[dom];
    }
  }

  static #epochTime: Time | null = null;

  /**
   * January 1st, 1970 as an ICAL.Time.
   * @type {Time}
   * @constant
   * @instance
   */
  static get epochTime() {
    if (!this.#epochTime) {
      this.#epochTime = Time.fromData({
        year: 1970,
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0,
        isDate: false,
        timezone: 'Z'
      });
    }
    return this.#epochTime;
  }

  static _cmp_attr(a, b, attr) {
    if (a[attr] > b[attr]) return 1;
    if (a[attr] < b[attr]) return -1;
    return 0;
  }

  /**
   * The days that have passed in the year after a given month. The array has
   * two members, one being an array of passed days for non-leap years, the
   * other analog for leap years.
   * @example
   * var isLeapYear = ICAL.Time.isLeapYear(year);
   * var passedDays = ICAL.Time.daysInYearPassedMonth[isLeapYear][month];
   */
  static daysInYearPassedMonth: number[][] = [
    [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365],
    [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366]
  ];

  static readonly SUNDAY = WeekDay.SUNDAY;
  static readonly MONDAY = WeekDay.MONDAY;
  static readonly TUESDAY = WeekDay.TUESDAY;
  static readonly WEDNESDAY = WeekDay.WEDNESDAY;
  static readonly THURSDAY = WeekDay.THURSDAY;
  static readonly FRIDAY = WeekDay.FRIDAY;
  static readonly SATURDAY = WeekDay.SATURDAY;

  /**
   * The default weekday for the WKST part.
   * @constant
   * @default ICAL.Time.MONDAY
   */
  static readonly DEFAULT_WEEK_START = 2; // MONDAY

  /**
   * Creates a new ICAL.Time instance.
   *
   * @param data Time initialization
   * @param zone timezone this position occurs in
   */
  constructor(data?: TimeData, zone?: Timezone) {
    this.wrappedJSObject = this;
    const time = (this._time = Object.create(null));

    /* time defaults */
    time.year = 0;
    time.month = 1;
    time.day = 1;
    time.hour = 0;
    time.minute = 0;
    time.second = 0;
    time.isDate = false;

    this.fromData(data, zone);
  }

  /**
   * The class identifier.
   */
  readonly icalclass: 'icaltime' | 'vcardtime' = 'icaltime';
  _cachedUnixTime: number | null = null;

  /**
   * The type name, to be used in the jCal object. This value may change and
   * is strictly defined by the {@link ICAL.Time#isDate isDate} member.
   * @default "date-time"
   */
  get icaltype(): 'date-and-or-time' | 'date' | 'date-time' {
    return this.isDate ? 'date' : 'date-time';
  }

  /**
   * The timezone for this time.
   * @type {Timezone}
   */
  zone?: Timezone;

  /**
   * Internal uses to indicate that a change has been made and the next read
   * operation must attempt to normalize the value (for example changing the
   * day to 33).
   */
  private _pendingNormalization = false;

  /**
   * Returns a clone of the time object.
   *
   * @return The cloned object
   */
  clone(): Time {
    return new Time(this._time, this.zone);
  }

  /**
   * Reset the time instance to epoch time
   */
  reset() {
    this.fromData(Time.epochTime);
    this.zone = Timezone.utcTimezone;
  }

  /**
   * Reset the time instance to the given date/time values.
   *
   * @param year     The year to set
   * @param month    The month to set
   * @param day      The day to set
   * @param hour     The hour to set
   * @param minute   The minute to set
   * @param second   The second to set
   * @param timezone The timezone to set
   */
  resetTo(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timezone?: Timezone
  ) {
    this.fromData({
      year,
      month,
      day,
      hour,
      minute,
      second,
      zone: timezone
    });
  }

  /**
   * Set up the current instance from the Javascript date value.
   *
   * @param aDate   The Javascript Date to read, or null to reset
   * @param useUTC  If true, the UTC values of the date will be used
   */
  fromJSDate(aDate: Date | null, useUTC?: boolean) {
    if (!aDate) {
      this.reset();
    } else if (useUTC) {
      this.zone = Timezone.utcTimezone;
      this.year = aDate.getUTCFullYear();
      this.month = aDate.getUTCMonth() + 1;
      this.day = aDate.getUTCDate();
      this.hour = aDate.getUTCHours();
      this.minute = aDate.getUTCMinutes();
      this.second = aDate.getUTCSeconds();
    } else {
      this.zone = Timezone.localTimezone;
      this.year = aDate.getFullYear();
      this.month = aDate.getMonth() + 1;
      this.day = aDate.getDate();
      this.hour = aDate.getHours();
      this.minute = aDate.getMinutes();
      this.second = aDate.getSeconds();
    }
    this._cachedUnixTime = null;
    return this;
  }

  /**
   * Sets up the current instance using members from the passed data object.
   *
   * @param aData Time initialization
   * @param aZone Timezone this position occurs in
   */
  fromData(aData?: TimeData, aZone?: Timezone) {
    if (aData) {
      for (const [key, value] of Object.entries(aData)) {
        // ical type cannot be set
        if (key === 'icaltype') continue;
        this[key] = value;
      }
    }

    if (aZone) {
      this.zone = aZone;
    }

    if (aData && !('isDate' in aData)) {
      this.isDate = !('hour' in aData);
    } else if (aData && 'isDate' in aData) {
      this.isDate = aData.isDate;
    }

    if (aData && 'timezone' in aData) {
      const zone = TimezoneService.get(aData.timezone);
      this.zone = zone || Timezone.localTimezone;
    }

    if (aData && 'zone' in aData) {
      this.zone = aData.zone;
    }

    if (!this.zone) {
      this.zone = Timezone.localTimezone;
    }

    this._cachedUnixTime = null;
    return this;
  }

  /**
   * Calculate the day of week.
   * @param aWeekStart The week start weekday, defaults to SUNDAY
   */
  dayOfWeek(aWeekStart?: WeekDay): WeekDay {
    const firstDow = aWeekStart || Time.SUNDAY;
    const dowCacheKey =
      (this.year << 12) + (this.month << 8) + (this.day << 3) + firstDow;
    if (dowCacheKey in Time._dowCache) {
      return Time._dowCache[dowCacheKey];
    }

    // Using Zeller's algorithm
    const q = this.day;
    const m = this.month + (this.month < 3 ? 12 : 0);
    const Y = this.year - (this.month < 3 ? 1 : 0);

    let h = q + Y + trunc(((m + 1) * 26) / 10) + trunc(Y / 4);
    // eslint-disable-next-line no-constant-condition
    if (true /* gregorian */) {
      // eslint-disable-line no-constant-condition
      h += trunc(Y / 100) * 6 + trunc(Y / 400);
    }

    // Normalize to 1 = wkst
    h = ((h + 7 - firstDow) % 7) + 1;
    Time._dowCache[dowCacheKey] = h;
    return h;
  }

  /**
   * Calculate the day of year.
   */
  dayOfYear(): number {
    const is_leap = Time.isLeapYear(this.year) ? 1 : 0;
    const diypm = Time.daysInYearPassedMonth;
    return diypm[is_leap][this.month - 1] + this.day;
  }

  /**
   * Returns a copy of the current date/time, rewound to the start of the
   * week. The resulting ICAL.Time instance is of icaltype date, even if this
   * is a date-time.
   *
   * @param aWeekStart The week start weekday, defaults to SUNDAY
   * @return The start of the week (cloned)
   */
  startOfWeek(aWeekStart?: WeekDay): Time {
    const firstDow = aWeekStart || Time.SUNDAY;
    const result = this.clone();
    result.day -= (this.dayOfWeek() + 7 - firstDow) % 7;
    result.isDate = true;
    result.hour = 0;
    result.minute = 0;
    result.second = 0;
    return result;
  }

  /**
   * Returns a copy of the current date/time, shifted to the end of the week.
   * The resulting ICAL.Time instance is of icaltype date, even if this is a
   * date-time.
   *
   * @param aWeekStart The week start weekday, defaults to SUNDAY
   * @return The end of the week (cloned)
   */
  endOfWeek(aWeekStart?: WeekDay): Time {
    const firstDow = aWeekStart || Time.SUNDAY;
    const result = this.clone();
    result.day += (7 - this.dayOfWeek() + firstDow - Time.SUNDAY) % 7;
    result.isDate = true;
    result.hour = 0;
    result.minute = 0;
    result.second = 0;
    return result;
  }

  /**
   * Returns a copy of the current date/time, rewound to the start of the
   * month. The resulting ICAL.Time instance is of icaltype date, even if
   * this is a date-time.
   *
   * @return The start of the month (cloned)
   */
  startOfMonth(): Time {
    const result = this.clone();
    result.day = 1;
    result.isDate = true;
    result.hour = 0;
    result.minute = 0;
    result.second = 0;
    return result;
  }

  /**
   * Returns a copy of the current date/time, shifted to the end of the
   * month.  The resulting ICAL.Time instance is of icaltype date, even if
   * this is a date-time.
   *
   * @return The end of the month (cloned)
   */
  endOfMonth(): Time {
    const result = this.clone();
    result.day = Time.daysInMonth(result.month, result.year);
    result.isDate = true;
    result.hour = 0;
    result.minute = 0;
    result.second = 0;
    return result;
  }

  /**
   * Returns a copy of the current date/time, rewound to the start of the
   * year. The resulting ICAL.Time instance is of icaltype date, even if
   * this is a date-time.
   *
   * @return The start of the year (cloned)
   */
  startOfYear(): Time {
    const result = this.clone();
    result.day = 1;
    result.month = 1;
    result.isDate = true;
    result.hour = 0;
    result.minute = 0;
    result.second = 0;
    return result;
  }

  /**
   * Returns a copy of the current date/time, shifted to the end of the
   * year.  The resulting ICAL.Time instance is of icaltype date, even if
   * this is a date-time.
   *
   * @return The end of the year (cloned)
   */
  endOfYear(): Time {
    const result = this.clone();
    result.day = 31;
    result.month = 12;
    result.isDate = true;
    result.hour = 0;
    result.minute = 0;
    result.second = 0;
    return result;
  }

  /**
   * First calculates the start of the week, then returns the day of year for
   * this date. If the day falls into the previous year, the day is zero or negative.
   *
   * @param aFirstDayOfWeek The week start weekday, defaults to SUNDAY
   * @return The calculated day of year
   */
  startDoyWeek(aFirstDayOfWeek?: WeekDay): number {
    const firstDow = aFirstDayOfWeek || Time.SUNDAY;
    let delta = this.dayOfWeek() - firstDow;
    if (delta < 0) delta += 7;
    return this.dayOfYear() - delta;
  }

  /**
   * Get the dominical letter for the current year. Letters range from A - G
   * for common years, and AG to GF for leap years.
   *
   * @param {Number} yr           The year to retrieve the letter for
   * @return {String}             The dominical letter.
   */
  getDominicalLetter(): string {
    return Time.getDominicalLetter(this.year);
  }

  /**
   * Finds the nthWeekDay relative to the current month (not day).  The
   * returned value is a day relative the month that this month belongs to so
   * 1 would indicate the first of the month and 40 would indicate a day in
   * the following month.
   *
   * @param {Number} aDayOfWeek   Day of the week see the day name constants
   * @param {Number} aPos         Nth occurrence of a given week day values
   *        of 1 and 0 both indicate the first weekday of that type. aPos may
   *        be either positive or negative
   *
   * @return {Number} numeric value indicating a day relative
   *                   to the current month of this time object
   */
  nthWeekDay(aDayOfWeek: number, aPos: number): number {
    const daysInMonth = Time.daysInMonth(this.month, this.year);
    let weekday;
    let pos = aPos;

    let start = 0;

    const otherDay = this.clone();

    if (pos >= 0) {
      otherDay.day = 1;

      // because 0 means no position has been given
      // 1 and 0 indicate the same day.
      if (pos !== 0) {
        // remove the extra numeric value
        pos--;
      }

      // set current start offset to current day.
      start = otherDay.day;

      // find the current day of week
      const startDow = otherDay.dayOfWeek();

      // calculate the difference between current
      // day of the week and desired day of the week
      let offset = aDayOfWeek - startDow;

      // if the offset goes into the past
      // week we add 7 so it goes into the next
      // week. We only want to go forward in time here.
      if (offset < 0) {
        // this is really important otherwise we would
        // end up with dates from in the past.
        offset += 7;
      }

      // add offset to start so start is the same
      // day of the week as the desired day of week.
      start += offset;

      // because we are going to add (and multiply)
      // the numeric value of the day we subtract it
      // from the start position so not to add it twice.
      start -= aDayOfWeek;

      // set week day
      weekday = aDayOfWeek;
    } else {
      // then we set it to the last day in the current month
      otherDay.day = daysInMonth;

      // find the ends weekday
      const endDow = otherDay.dayOfWeek();

      pos++;

      weekday = endDow - aDayOfWeek;

      if (weekday < 0) {
        weekday += 7;
      }

      weekday = daysInMonth - weekday;
    }

    weekday += pos * 7;

    return start + weekday;
  }

  /**
   * Checks if current time is the nth weekday, relative to the current
   * month.  Will always return false when rule resolves outside of current
   * month.
   *
   * @param {Time.weekDay} aDayOfWeek       Day of week to check
   * @param {Number} aPos                        Relative position
   * @return {Boolean}                           True, if it is the nth weekday
   */
  isNthWeekDay(aDayOfWeek: WeekDay, aPos: number): boolean {
    const dow = this.dayOfWeek();

    if (aPos === 0 && dow === aDayOfWeek) {
      return true;
    }

    // get pos
    const day = this.nthWeekDay(aDayOfWeek, aPos);

    if (day === this.day) {
      return true;
    }

    return false;
  }

  /**
   * Calculates the ISO 8601 week number. The first week of a year is the
   * week that contains the first Thursday. The year can have 53 weeks, if
   * January 1st is a Friday.
   *
   * Note there are regions where the first week of the year is the one that
   * starts on January 1st, which may offset the week number. Also, if a
   * different week start is specified, this will also affect the week
   * number.
   *
   * @see ICAL.Time.weekOneStarts
   * @param {Time.weekDay} aWeekStart        The weekday the week starts with
   * @return {Number}                             The ISO week number
   */
  weekNumber(aWeekStart: WeekDay): number {
    const wnCacheKey =
      (this.year << 12) + (this.month << 8) + (this.day << 3) + aWeekStart;
    if (wnCacheKey in Time._wnCache) {
      return Time._wnCache[wnCacheKey];
    }
    // This function courtesty of Julian Bucknall, published under the MIT license
    // http://www.boyet.com/articles/publishedarticles/calculatingtheisoweeknumb.html
    // plus some fixes to be able to use different week starts.
    let week1;

    const dt = this.clone();
    dt.isDate = true;
    let isoyear = this.year;

    if (dt.month === 12 && dt.day > 25) {
      week1 = Time.weekOneStarts(isoyear + 1, aWeekStart);
      if (dt.compare(week1) < 0) {
        week1 = Time.weekOneStarts(isoyear, aWeekStart);
      } else {
        isoyear++;
      }
    } else {
      week1 = Time.weekOneStarts(isoyear, aWeekStart);
      if (dt.compare(week1) < 0) {
        week1 = Time.weekOneStarts(--isoyear, aWeekStart);
      }
    }

    const daysBetween = dt.subtractDate(week1).toSeconds() / 86400;
    const answer = trunc(daysBetween / 7) + 1;
    Time._wnCache[wnCacheKey] = answer;
    return answer;
  }

  /**
   * Adds the duration to the current time. The instance is modified in
   * place.
   *
   * @param {Duration} aDuration         The duration to add
   */
  addDuration(aDuration: Duration) {
    const mult = aDuration.isNegative ? -1 : 1;

    // because of the duration optimizations it is much
    // more efficient to grab all the values up front
    // then set them directly (which will avoid a normalization call).
    // So we don't actually normalize until we need it.
    let { second } = this;
    let { minute } = this;
    let { hour } = this;
    let { day } = this;

    second += mult * aDuration.seconds;
    minute += mult * aDuration.minutes;
    hour += mult * aDuration.hours;
    day += mult * aDuration.days;
    day += mult * 7 * aDuration.weeks;

    this.second = second;
    this.minute = minute;
    this.hour = hour;
    this.day = day;

    this._cachedUnixTime = null;
  }

  /**
   * Subtract the date details (_excluding_ timezone).  Useful for finding
   * the relative difference between two time objects excluding their
   * timezone differences.
   *
   * @param aDate The date to subtract
   * @return      The difference as a duration
   */
  subtractDate(aDate: Time): Duration {
    const unixTime = this.toUnixTime() + this.utcOffset();
    const other = aDate.toUnixTime() + aDate.utcOffset();
    return Duration.fromSeconds(unixTime - other);
  }

  /**
   * Subtract the date details, taking timezones into account.
   *
   * @param aDate The date to subtract
   * @return      The difference in duration
   */
  subtractDateTz(aDate: Time): Duration {
    const unixTime = this.toUnixTime();
    const other = aDate.toUnixTime();
    return Duration.fromSeconds(unixTime - other);
  }

  /**
   * Compares the ICAL.Time instance with another one.
   *
   * @param aOther The instance to compare with
   * @return       -1, 0 or 1 for less/equal/greater
   */
  compare(other: Duration): number {
    const a = this.toUnixTime();
    const b = other.toUnixTime();

    if (a > b) return 1;
    if (b > a) return -1;
    return 0;
  }

  /**
   * Compares only the date part of this instance with another one.
   *
   * @param other The instance to compare with
   * @param tz    The timezone to compare in
   * @return      -1, 0 or 1 for less/equal/greater
   */
  compareDateOnlyTz(other: Duration, tz: Timezone): number {
    const a = this.convertToZone(tz);
    const b = other.convertToZone(tz);
    let rc = 0;

    if ((rc = Time._cmp_attr(a, b, 'year')) !== 0) return rc;
    if ((rc = Time._cmp_attr(a, b, 'month')) !== 0) return rc;
    if ((rc = Time._cmp_attr(a, b, 'day')) !== 0) return rc;

    return rc;
  }

  /**
   * Convert the instance into another timezone. The returned ICAL.Time
   * instance is always a copy.
   *
   * @param zone The zone to convert to
   * @return     The copy, converted to the zone
   */
  convertToZone(zone: Timezone): Time {
    const copy = this.clone();
    const zone_equals = this.zone!.tzid === zone.tzid;

    if (!this.isDate && !zone_equals) {
      Timezone.convert_time(copy, this.zone!, zone);
    }

    copy.zone = zone;
    return copy;
  }

  /**
   * Calculates the UTC offset of the current date/time in the timezone it is
   * in.
   *
   * @return UTC offset in seconds
   */
  utcOffset(): number {
    if (
      this.zone === Timezone.localTimezone ||
      this.zone === Timezone.utcTimezone
    ) {
      return 0;
    } else {
      return this.zone!.utcOffset(this);
    }
  }

  /**
   * Returns an RFC 5545 compliant ical representation of this object.
   *
   * @return ical date/date-time
   */
  toICALString(): string {
    const string = this.toString();

    if (string.length > 10) {
      return design.icalendar.value['date-time'].toICAL(string);
    } else {
      return design.icalendar.value.date.toICAL(string);
    }
  }

  /**
   * The string representation of this date/time, in jCal form
   * (including : and - separators).
   */
  toString(): string {
    let result = this.year + '-' + pad2(this.month) + '-' + pad2(this.day);

    if (!this.isDate) {
      result +=
        'T' +
        pad2(this.hour) +
        ':' +
        pad2(this.minute) +
        ':' +
        pad2(this.second);

      if (this.zone === Timezone.utcTimezone) {
        result += 'Z';
      }
    }

    return result;
  }

  /**
   * Converts the current instance to a Javascript date
   */
  toJSDate(): Date {
    if (this.zone === Timezone.localTimezone) {
      if (this.isDate) {
        return new Date(this.year, this.month - 1, this.day);
      } else {
        return new Date(
          this.year,
          this.month - 1,
          this.day,
          this.hour,
          this.minute,
          this.second,
          0
        );
      }
    } else {
      return new Date(this.toUnixTime() * 1000);
    }
  }

  protected _normalize() {
    if (this._time.isDate) {
      this._time.hour = 0;
      this._time.minute = 0;
      this._time.second = 0;
    }
    this.adjust(0, 0, 0, 0);

    return this;
  }

  /**
   * Adjust the date/time by the given offset
   *
   * @param aExtraDays    The extra amount of days
   * @param aExtraHours   The extra amount of hours
   * @param aExtraMinutes The extra amount of minutes
   * @param aExtraSeconds The extra amount of seconds
   * @param aTime         The time to adjust, defaults to the current instance.
   */
  adjust(
    aExtraDays: number,
    aExtraHours: number,
    aExtraMinutes: number,
    aExtraSeconds: number,
    aTime?: Required<TimeData>
  ) {
    let minutesOverflow;
    let hoursOverflow;
    let daysOverflow = 0;
    let yearsOverflow = 0;

    let second: number;
    let minute;
    let hour;
    let day;
    let daysInMonth;

    const time = aTime || this._time;

    if (!time.isDate) {
      second = time.second + aExtraSeconds;
      time.second = second % 60;
      minutesOverflow = trunc(second / 60);
      if (time.second < 0) {
        time.second += 60;
        minutesOverflow--;
      }

      minute = time.minute + aExtraMinutes + minutesOverflow;
      time.minute = minute % 60;
      hoursOverflow = trunc(minute / 60);
      if (time.minute < 0) {
        time.minute += 60;
        hoursOverflow--;
      }

      hour = time.hour + aExtraHours + hoursOverflow;

      time.hour = hour % 24;
      daysOverflow = trunc(hour / 24);
      if (time.hour < 0) {
        time.hour += 24;
        daysOverflow--;
      }
    }

    // Adjust month and year first, because we need to know what month the day
    // is in before adjusting it.
    if (time.month > 12) {
      yearsOverflow = trunc((time.month - 1) / 12);
    } else if (time.month < 1) {
      yearsOverflow = trunc(time.month / 12) - 1;
    }

    time.year += yearsOverflow;
    time.month -= 12 * yearsOverflow;

    // Now take care of the days (and adjust month if needed)
    day = time.day + aExtraDays + daysOverflow;

    if (day > 0) {
      for (;;) {
        daysInMonth = Time.daysInMonth(time.month, time.year);
        if (day <= daysInMonth) {
          break;
        }

        time.month++;
        if (time.month > 12) {
          time.year++;
          time.month = 1;
        }

        day -= daysInMonth;
      }
    } else {
      while (day <= 0) {
        if (time.month === 1) {
          time.year--;
          time.month = 12;
        } else {
          time.month--;
        }

        day += Time.daysInMonth(time.month, time.year);
      }
    }

    time.day = day;

    this._cachedUnixTime = null;
    return this;
  }

  /**
   * Sets up the current instance from unix time, the number of seconds since
   * January 1st, 1970.
   *
   * @param seconds The seconds to set up with
   */
  fromUnixTime(seconds: number) {
    this.zone = Timezone.utcTimezone;
    // We could use `fromJSDate` here, but this is about twice as fast.
    // We could also clone `epochTime` and use `adjust` for a more
    // ical.js-centric approach, but this is about 100 times as fast.
    const date = new Date(seconds * 1000);
    this.year = date.getUTCFullYear();
    this.month = date.getUTCMonth() + 1;
    this.day = date.getUTCDate();
    if (this._time.isDate) {
      this.hour = 0;
      this.minute = 0;
      this.second = 0;
    } else {
      this.hour = date.getUTCHours();
      this.minute = date.getUTCMinutes();
      this.second = date.getUTCSeconds();
    }

    this._cachedUnixTime = null;
  }

  /**
   * Converts the current instance to seconds since January 1st 1970.
   *
   * @return Seconds since 1970
   */
  toUnixTime(): number {
    if (this._cachedUnixTime !== null) {
      return this._cachedUnixTime;
    }
    const offset = this.utcOffset();

    // we use the offset trick to ensure
    // that we are getting the actual UTC time
    const ms = Date.UTC(
      this.year,
      this.month - 1,
      this.day,
      this.hour,
      this.minute,
      this.second - offset
    );

    // seconds
    this._cachedUnixTime = ms / 1000;
    return this._cachedUnixTime;
  }

  /**
   * Converts time to into Object which can be serialized then re-created
   * using the constructor.
   *
   * @example
   * // toJSON will automatically be called
   * var json = JSON.stringify(mytime);
   *
   * var deserialized = JSON.parse(json);
   *
   * var time = new ICAL.Time(deserialized);
   *
   * @return {Object}
   */
  toJSON(): Record<string, any> {
    const copy = ['year', 'month', 'day', 'hour', 'minute', 'second', 'isDate'];

    const result = Object.create(null);

    let i = 0;
    const len = copy.length;
    let prop;

    for (; i < len; i++) {
      prop = copy[i];
      result[prop] = this[prop];
    }

    if (this.zone) {
      result.timezone = this.zone.tzid;
    }

    return result;
  }
}

(function setupNormalizeAttributes() {
  // This needs to run before any instances are created!
  function defineAttr(attr: string) {
    Object.defineProperty(Time.prototype, attr, {
      get: function getTimeAttr() {
        if (this._pendingNormalization) {
          this._normalize();
          this._pendingNormalization = false;
        }

        return this._time[attr];
      },
      set: function setTimeAttr(val) {
        // Check if isDate will be set and if was not set to normalize date.
        // This avoids losing days when seconds, minutes and hours are zeroed
        // what normalize will do when time is a date.
        if (attr === 'isDate' && val && !this._time.isDate) {
          this.adjust(0, 0, 0, 0);
        }
        this._cachedUnixTime = null;
        this._pendingNormalization = true;
        this._time[attr] = val;
      }
    });
  }

  defineAttr('year');
  defineAttr('month');
  defineAttr('day');
  defineAttr('hour');
  defineAttr('minute');
  defineAttr('second');
  defineAttr('isDate');
})();
