/**
 * German PLZ → Region/City validation (offline, no API needed)
 * PLZ ranges map to regions. First 1-2 digits identify the Leitzone.
 * Source: Deutsche Post PLZ-System
 */

// PLZ Leitzone (first 2 digits) → expected cities/regions
const PLZ_REGIONS: Record<string, string[]> = {
  '01': ['Dresden', 'Meißen', 'Riesa', 'Freital', 'Pirna', 'Radebeul'],
  '02': ['Görlitz', 'Bautzen', 'Zittau', 'Hoyerswerda'],
  '03': ['Cottbus', 'Senftenberg', 'Spremberg', 'Forst'],
  '04': ['Leipzig', 'Markkleeberg', 'Taucha', 'Schkeuditz', 'Delitzsch'],
  '06': ['Halle', 'Merseburg', 'Dessau', 'Wittenberg', 'Bitterfeld'],
  '07': ['Gera', 'Jena', 'Greiz', 'Altenburg'],
  '08': ['Zwickau', 'Plauen', 'Auerbach', 'Reichenbach'],
  '09': ['Chemnitz', 'Freiberg', 'Annaberg', 'Aue', 'Stollberg'],
  '10': ['Berlin'],
  '11': ['Berlin'],
  '12': ['Berlin'],
  '13': ['Berlin'],
  '14': ['Berlin', 'Potsdam', 'Falkensee', 'Oranienburg', 'Bernau'],
  '15': ['Frankfurt (Oder)', 'Eisenhüttenstadt', 'Fürstenwalde'],
  '16': ['Eberswalde', 'Schwedt', 'Prenzlau', 'Templin'],
  '17': ['Neubrandenburg', 'Greifswald', 'Stralsund', 'Rostock'],
  '18': ['Rostock', 'Wismar', 'Bad Doberan', 'Güstrow'],
  '19': ['Schwerin', 'Ludwigslust', 'Parchim'],
  '20': ['Hamburg'],
  '21': ['Hamburg', 'Lüneburg', 'Buchholz', 'Buxtehude', 'Stade'],
  '22': ['Hamburg'],
  '23': ['Lübeck', 'Bad Segeberg', 'Eutin', 'Ahrensburg'],
  '24': ['Kiel', 'Rendsburg', 'Eckernförde', 'Neumünster'],
  '25': ['Pinneberg', 'Elmshorn', 'Itzehoe', 'Heide', 'Husum'],
  '26': ['Oldenburg', 'Emden', 'Aurich', 'Wilhelmshaven', 'Leer'],
  '27': ['Bremen', 'Bremerhaven', 'Cuxhaven', 'Verden'],
  '28': ['Bremen'],
  '29': ['Celle', 'Uelzen', 'Soltau', 'Walsrode'],
  '30': ['Hannover'],
  '31': ['Hannover', 'Burgdorf', 'Peine', 'Hildesheim'],
  '32': ['Herford', 'Minden', 'Bad Oeynhausen', 'Bünde'],
  '33': ['Bielefeld', 'Paderborn', 'Gütersloh', 'Detmold'],
  '34': ['Kassel', 'Baunatal', 'Melsungen'],
  '35': ['Gießen', 'Marburg', 'Wetzlar'],
  '36': ['Fulda', 'Bad Hersfeld', 'Alsfeld'],
  '37': ['Göttingen', 'Northeim', 'Einbeck'],
  '38': ['Braunschweig', 'Wolfsburg', 'Salzgitter', 'Wolfenbüttel', 'Goslar'],
  '39': ['Magdeburg', 'Stendal', 'Halberstadt'],
  '40': ['Düsseldorf'],
  '41': ['Mönchengladbach', 'Viersen', 'Grevenbroich'],
  '42': ['Wuppertal', 'Solingen', 'Remscheid'],
  '43': ['Essen'],
  '44': ['Dortmund', 'Bochum', 'Herne', 'Castrop-Rauxel'],
  '45': ['Essen', 'Mülheim', 'Oberhausen', 'Gelsenkirchen'],
  '46': ['Oberhausen', 'Bottrop', 'Dinslaken', 'Moers'],
  '47': ['Duisburg', 'Krefeld', 'Kleve'],
  '48': ['Münster', 'Steinfurt', 'Coesfeld'],
  '49': ['Osnabrück', 'Meppen', 'Lingen', 'Nordhorn'],
  '50': ['Köln'],
  '51': ['Köln', 'Leverkusen', 'Bergisch Gladbach'],
  '52': ['Aachen', 'Stolberg', 'Eschweiler'],
  '53': ['Bonn', 'Siegburg', 'Troisdorf', 'Bad Honnef'],
  '54': ['Trier', 'Wittlich', 'Bitburg'],
  '55': ['Mainz', 'Bad Kreuznach', 'Bingen'],
  '56': ['Koblenz', 'Neuwied', 'Andernach', 'Mayen'],
  '57': ['Siegen', 'Olpe', 'Kreuztal'],
  '58': ['Hagen', 'Iserlohn', 'Lüdenscheid', 'Schwerte'],
  '59': ['Hamm', 'Unna', 'Soest', 'Arnsberg', 'Lippstadt'],
  '60': ['Frankfurt am Main', 'Frankfurt'],
  '61': ['Frankfurt', 'Bad Vilbel', 'Friedberg', 'Bad Homburg'],
  '63': ['Offenbach', 'Hanau', 'Aschaffenburg'],
  '64': ['Darmstadt', 'Bensheim', 'Groß-Gerau'],
  '65': ['Wiesbaden', 'Rüsselsheim', 'Limburg'],
  '66': ['Saarbrücken', 'Neunkirchen', 'Homburg', 'St. Ingbert'],
  '67': ['Ludwigshafen', 'Kaiserslautern', 'Frankenthal', 'Speyer'],
  '68': ['Mannheim', 'Heidelberg', 'Weinheim'],
  '69': ['Heidelberg', 'Sinsheim', 'Eberbach'],
  '70': ['Stuttgart'],
  '71': ['Stuttgart', 'Böblingen', 'Sindelfingen', 'Ludwigsburg'],
  '72': ['Tübingen', 'Reutlingen', 'Rottenburg'],
  '73': ['Esslingen', 'Göppingen', 'Kirchheim', 'Aalen'],
  '74': ['Heilbronn', 'Schwäbisch Hall', 'Öhringen'],
  '75': ['Pforzheim', 'Calw', 'Nagold'],
  '76': ['Karlsruhe', 'Rastatt', 'Ettlingen'],
  '77': ['Offenburg', 'Lahr', 'Kehl'],
  '78': ['Villingen-Schwenningen', 'Konstanz', 'Rottweil', 'Tuttlingen'],
  '79': ['Freiburg', 'Lörrach', 'Emmendingen', 'Müllheim'],
  '80': ['München'],
  '81': ['München'],
  '82': ['München', 'Starnberg', 'Germering', 'Fürstenfeldbruck', 'Garmisch-Partenkirchen'],
  '83': ['Rosenheim', 'Traunstein', 'Bad Reichenhall', 'Wasserburg'],
  '84': ['Landshut', 'Dingolfing', 'Altötting'],
  '85': ['München', 'Freising', 'Erding', 'Dachau', 'Ingolstadt'],
  '86': ['Augsburg', 'Donauwörth', 'Neuburg'],
  '87': ['Kempten', 'Kaufbeuren', 'Memmingen'],
  '88': ['Ravensburg', 'Friedrichshafen', 'Lindau', 'Biberach'],
  '89': ['Ulm', 'Neu-Ulm', 'Heidenheim', 'Günzburg'],
  '90': ['Nürnberg'],
  '91': ['Nürnberg', 'Erlangen', 'Fürth', 'Herzogenaurach'],
  '92': ['Amberg', 'Weiden', 'Neumarkt'],
  '93': ['Regensburg', 'Cham', 'Schwandorf'],
  '94': ['Passau', 'Deggendorf', 'Straubing'],
  '95': ['Bayreuth', 'Hof', 'Kulmbach', 'Selb'],
  '96': ['Bamberg', 'Coburg', 'Lichtenfels', 'Kronach'],
  '97': ['Würzburg', 'Schweinfurt', 'Kitzingen', 'Bad Kissingen'],
  '98': ['Suhl', 'Hildburghausen', 'Meiningen', 'Schmalkalden'],
  '99': ['Erfurt', 'Weimar', 'Eisenach', 'Gotha', 'Nordhausen'],
}

/**
 * Get the most likely city for a German PLZ.
 * Returns the primary city for the PLZ Leitzone, or null if unknown.
 */
export function getCityForPLZ(plz: string): string | null {
  if (!plz || plz.length < 2) return null
  const leitzone = plz.slice(0, 2)
  const cities = PLZ_REGIONS[leitzone]
  return cities?.[0] ?? null
}

export interface AddressValidationResult {
  valid: boolean
  warnings: Array<{ field: string; message: { de: string; en: string; ar: string } }>
  suggestion?: { city?: string }
}

/**
 * Validate address offline — no API call needed.
 * Checks: required fields, min lengths, PLZ format, PLZ↔City match
 */
export function validateAddressOffline(address: {
  firstName?: string
  lastName?: string
  street?: string
  houseNumber?: string
  postalCode?: string
  city?: string
  country?: string
}): AddressValidationResult {
  const warnings: AddressValidationResult['warnings'] = []
  let suggestion: AddressValidationResult['suggestion'] | undefined

  // Required + min length checks
  if (!address.firstName || address.firstName.trim().length < 2) {
    warnings.push({ field: 'firstName', message: { de: 'Vorname zu kurz (mind. 2 Zeichen)', en: 'First name too short (min 2 chars)', ar: 'الاسم الأول قصير جداً (حرفان على الأقل)' } })
  }
  if (!address.lastName || address.lastName.trim().length < 2) {
    warnings.push({ field: 'lastName', message: { de: 'Nachname zu kurz (mind. 2 Zeichen)', en: 'Last name too short (min 2 chars)', ar: 'اللقب قصير جداً (حرفان على الأقل)' } })
  }
  if (!address.street || address.street.trim().length < 3) {
    warnings.push({ field: 'street', message: { de: 'Straße zu kurz (mind. 3 Zeichen)', en: 'Street too short (min 3 chars)', ar: 'الشارع قصير جداً (3 أحرف على الأقل)' } })
  }
  if (!address.houseNumber || address.houseNumber.trim().length < 1) {
    warnings.push({ field: 'houseNumber', message: { de: 'Hausnummer fehlt', en: 'House number missing', ar: 'رقم المنزل مفقود' } })
  }
  if (!address.city || address.city.trim().length < 2) {
    warnings.push({ field: 'city', message: { de: 'Stadt zu kurz (mind. 2 Zeichen)', en: 'City too short (min 2 chars)', ar: 'المدينة قصيرة جداً (حرفان على الأقل)' } })
  }

  const country = (address.country ?? 'DE').toUpperCase()
  const plz = address.postalCode?.trim() ?? ''

  // PLZ format check
  if (country === 'DE') {
    if (!/^\d{5}$/.test(plz)) {
      warnings.push({ field: 'postalCode', message: { de: 'Deutsche PLZ muss 5 Ziffern haben', en: 'German postal code must be 5 digits', ar: 'الرمز البريدي الألماني يجب أن يكون 5 أرقام' } })
    } else {
      // PLZ ↔ City match
      const leitzone = plz.slice(0, 2)
      const regionCities = PLZ_REGIONS[leitzone]
      if (regionCities && address.city) {
        const cityLower = address.city.trim().toLowerCase()
        const match = regionCities.some(c => cityLower.includes(c.toLowerCase()) || c.toLowerCase().includes(cityLower))
        if (!match && cityLower.length >= 3) {
          warnings.push({
            field: 'city',
            message: {
              de: `PLZ ${plz} gehört zur Region ${regionCities[0]} — "${address.city}" passt nicht dazu`,
              en: `Postal code ${plz} belongs to ${regionCities[0]} region — "${address.city}" doesn't match`,
              ar: `الرمز البريدي \u200E${plz}\u200F ينتمي لمنطقة \u200E${regionCities[0]}\u200F — المدينة "\u200E${address.city}\u200F" لا تتطابق`,
            },
          })
          suggestion = { city: regionCities[0] }
        }
      }
    }
  } else if (['AT', 'CH', 'BE', 'NL'].includes(country)) {
    if (!/^\d{4,5}$/.test(plz)) {
      warnings.push({ field: 'postalCode', message: { de: 'PLZ ungültig', en: 'Invalid postal code', ar: 'الرمز البريدي غير صالح' } })
    }
  }

  return { valid: warnings.length === 0, warnings, suggestion }
}
