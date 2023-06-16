import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs-extra';
import process from 'node:process';
import { DB_LOCATION as dbLocation } from './constants.js';
import { upgradeDatabase } from './database-upgrade.js';

let db = null;

function genericInsert(table, columns, placeholders, data) {
  return db.run(`
  INSERT INTO ${table} (${columns})
  VALUES ${placeholders.join(',')}
`, ...data);
}
export function getGalleryPage(offset = 0, count = 25, query = {}, sortOrder ='DESC') {
  let { username, searchTerm, galleryType } = query;
  let searchQuery = '';
  let galleryQuery = '';
  let usernameQuery = '';

  if (searchTerm) {
    searchTerm = `${searchTerm.replace(/\s/gi, '%')}`;
    searchQuery =`
      AND (
        title LIKE '%${searchTerm}%'
        OR
        tags LIKE '%${searchTerm}%'
        OR
        desc LIKE '%${searchTerm}%'
        OR 
        content_name LIKE '%${searchTerm}'
      )`;
  }
  if (galleryType && username) {
    galleryQuery = `
      AND url IN (
        SELECT url
        FROM favorites f
        WHERE f.username LIKE '%${username}%'
      )
    `;
  } else {
    if (username) {
      usernameQuery = `
        AND username LIKE '%${username}%'
        `;
    }
  }
  const dbQuery = `
  SELECT 
    id, 
    title,
    username,
    content_name,
    content_url,
    date_uploaded,
    is_content_saved,
    thumbnail_name,
    is_thumbnail_saved
  FROM subdata
  WHERE id IS NOT NULL
  ${searchQuery}
  ${usernameQuery}
  ${galleryQuery}
  ORDER BY content_name ${sortOrder}
  LIMIT ${count} OFFSET ${offset}
  `;
  return db.all(dbQuery);
}
/**
 * Returns all 
 * @param {String} id 
 * @returns 
 */
export async function getSubmissionPage(id) {
  const data = {};
  data.submission = await db.get(`
  SELECT *
  FROM subdata
  WHERE id = ${id}
  `);
  data.comments = await db.all(`
    SELECT *
    FROM commentdata
    WHERE submission_id = '${id}'
  `);
  return data;
}
/**
 * Marks the given content_url as saved (downloaded).
 * @param {String} content_url 
 * @returns Database Promise
 */
export function setContentSaved(content_url) {
  return db.run(`
  UPDATE subdata
  SET
    is_content_saved = 1,
    moved_content = 1
  WHERE content_url = '${content_url}'
  `);
}
export function setContentMoved(content_name) {
  return db.run(`
  UPDATE subdata
  SET
    moved_content = 1
  WHERE content_name = '${content_name}'
  `);
}
export function setThumbnailSaved(url, thumbnail_url, thumbnail_name) {
  return db.run(`
    UPDATE subdata
    SET
      is_thumbnail_saved = 1,
      thumbnail_url = '${thumbnail_url}',
      thumbnail_name = '${thumbnail_name}'
    WHERE url = '${url}'
  `);
}
export function getAllUnmovedContentData() {
  return db.all(`
  SELECT content_url, content_name, username
  FROM subdata
  WHERE is_content_saved = 1
    AND moved_content = 0
  `);
}
/**
 * Retrieves all unsaved content to download.
 * @returns Database Promise that resolves to results of query
 */
export function getAllUnsavedContent(name) {
  const defaultQuery = `
    SELECT content_url, content_name, username
    FROM subdata
    WHERE is_content_saved = 0
    AND content_url IS NOT NULL
    AND username IS NOT NULL
    ORDER BY content_name DESC
  `;
  if (!name) return db.all(defaultQuery);
  const query =`
    SELECT content_url, content_name, username
    FROM subdata
    WHERE is_content_saved = 0
    AND content_url IS NOT NULL
    AND username LIKE '${name}'
    ORDER BY content_name DESC
  `;
  return db.all(query).then(results => {
    if (!results?.content_name) return db.all(defaultQuery);
    else return results;
  });
}

export function getAllUnsavedThumbnails() {
  return db.all(`
    SELECT url, content_url, username, thumbnail_url
    FROM subdata
    WHERE is_thumbnail_saved = 0
    AND username IS NOT NULL
    AND (
      content_url LIKE '%/stories/%'
      OR content_url LIKE '%/music/%'
      OR content_url LIKE '%/poetry/%'
    )
    ORDER BY content_name DESC
  `);
}
/**
 * Returns all entries without necessary data.
 * @returns 
 */
export function needsRepair() {
  return db.all(`
  SELECT url
  FROM subdata
  WHERE username IS NULL
  AND id IS NOT NULL
  `);
}
export function getAllUsernames() {
  return db.all(`
  SELECT DISTINCT username
  FROM subdata
  WHERE username IS NOT NULL
  `);
}
/**
 * Takes the given data for the given url and updates the appropriate database columns.
 * @param {String} url 
 * @param {Object} d 
 * @returns Database Promise
 */
export function saveMetaData(url, d) {
  const data = [];
  let queryNames = Object.getOwnPropertyNames(d)
  .map(key => {
    data.push(d[key]);
    return `${key} = ?`
  });
  return db.run(`
  UPDATE subdata
  SET 
    ${queryNames.join(',')}
  WHERE url = '${url}'`, ...data);
}
/**
 * Retrieves all submission links with uncollected data.
 * @param {Boolean} isScraps 
 * @returns Promise that resolves to all matching Database rows
 */
export function getSubmissionLinks() {
  return db.all(`
  SELECT rowid, url
  FROM subdata
  WHERE id IS null
  ORDER BY url DESC
  `);
}
/**
 * Creates blank entries in the database for all given submission URLs
 * for later updating.
 * @param {Array<Strings>} links 
 * @param {Boolean} isScraps 
 * @returns 
 */
export function saveLinks(links, isScraps = false) {
  let placeholder = [];
  const data = links.reduce((acc, val) => {
    let data = [val, isScraps, false];
    let marks = `(${data.map(()=>'?').join(',')})`;
    acc.push(...data);
    placeholder.push(marks);
    return acc;
    }, []);
  return genericInsert('subdata', 'url, is_scrap, is_content_saved', placeholder, data);
}
export function saveComments(comments) {
  let placeholder = [];
  const data = comments.reduce((acc, c) => {
    let data = [c.id, c.submission_id, c.width, c.username, c.desc, c.subtitle, c.date];
    let marks = `(${data.map(()=>'?').join(',')})`;
    acc.push(...data);
    placeholder.push(marks);
    return acc;
  }, []);
  placeholder.join(',');
  return db.run(`
  INSERT INTO commentdata (
    id,
    submission_id,
    width,
    username,
    desc,
    subtitle,
    date
  ) 
  VALUES ${placeholder}
  ON CONFLICT(id) DO UPDATE SET
    desc = excluded.desc
  `, ...data);
}
export function getComments(id) {
  return db.all(`
  SELECT *
  FROM commentdata
  WHERE submission_id = ${id}
  AND desc IS NOT NULL
  `);
}
export function setOwnedAccount(username) {
  if (!username) return;
  return genericInsert('ownedaccounts', 'username', ['(?)'], [username]);
}
export function getOwnedAccounts() {
  return db.all(`
    SELECT *
    FROM ownedaccounts
  `);
}
export function saveFavorites(username, links) {
  let placeholder = [];
  const data = links.reduce((acc, val) => {
    let data = [username+val, username, val];
    let marks = `(${data.map(()=>'?').join(',')})`;
    acc.push(...data);
    placeholder.push(marks);
    return acc;
    }, []);
  return genericInsert('favorites', 'id, username, url', placeholder, data);
}
export function getAllFavoritesForUser(username) {
  if (!username) return;
  return db.all(`
    SELECT *
    FROM subdata
    WHERE url IN (
      SELECT url
      FROM favorites
      WHERE username = '${username}'
    )
  `);
}
/**
 * 
 * @returns All data in the database
 */
export function getAllSubmissionData() {
  return db.all('SELECT url from subdata');
}
/**
 * 
 * @returns All complete data in the database
 */
export function getAllCompleteSubmissionData() {
  return db.all('SELECT * from subdata WHERE id IS NOT NULL');
}


// Saving user settings
export async function saveUserSettings(userSettings) {
  let data = Object.getOwnPropertyNames(userSettings)
  .map((key) => {
    let val = userSettings[key];
    switch (typeof val) {
      case 'string':
        val = `'${val}'`;
        break;
      case 'object':
        val = `'${JSON.stringify(val)}'`;
        break;
    }
    return `${key} = ${val}`
  });
  db.run(`
  UPDATE usersettings
  SET ${data.join(',')}
  `);
}
export async function getUserSettings() {
  return db.get(`SELECT * FROM usersettings`);
}

export async function close() {
  return db.close();
}

/**
 * Creates appropriate database tables.
 * @returns 
 */
export async function init() {
  fs.ensureFileSync(dbLocation);
  sqlite3.verbose();
  db = await open({
    filename: dbLocation,
    driver: sqlite3.cached.Database,
  });
  // Check for existence of necessary tables
  return db.get(`
    SELECT name 
    FROM sqlite_master 
    WHERE type='table' AND name='subdata'
  `).then(({ name } = {}) => {
    // If not found, we need to create the table
    if (!name) {
      return db.exec(`
        CREATE TABLE subdata (
          id TEXT PRIMARY KEY,
          title TEXT, 
          desc TEXT, 
          tags TEXT, 
          url TEXT UNIQUE ON CONFLICT IGNORE, 
          is_scrap INTEGER, 
          date_uploaded TEXT, 
          content_url TEXT, 
          content_name TEXT, 
          is_content_saved INTEGER,
          username TEXT
        )`)
        .then(db.exec(`PRAGMA user_version = 2`));
    }
  })
  .then(() => {
    upgradeDatabase(db);
  })
  .catch(async (e) => {
    console.error(e);
    await db.close();
    process.exit(2);
  });
}
