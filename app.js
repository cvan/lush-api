var fs = require('fs');
var path = require('path');

var async = require('async');
var cheerio = require('cheerio');
var request = require('request');
var sanitizeHtml = require('sanitize-html');

var server = require('./server');
var utils = require('./lib/utils');


const BASE_ORIGIN = 'http://www.estatesales.net';
const BASE_URL = BASE_ORIGIN + '/estate-sales/';
const IMG_ORIGIN = 'http://pictures.EstateSales.NET';

const CITIES = {};
CITIES.mi = [
    'MI/Adrian.aspx',
    'MI/Allegan.aspx',
    'MI/Alma.aspx',
    'MI/Alpena.aspx',
    'MI/Ann-Arbor.aspx',
    'MI/Battle-Creek.aspx',
    'MI/Bay-City.aspx',
    'MI/Big-Rapids.aspx',
    'MI/Cadillac.aspx',
    'MI/Coldwater.aspx',
    'MI/Detroit.aspx',
    'MI/Escanaba.aspx',
    'MI/Flint.aspx',
    'MI/Grand-Rapids.aspx',
    'MI/Holland-Grand-Haven.aspx',
    'MI/Houghton.aspx',
    'MI/Jackson.aspx',
    'MI/Kalamazoo-Portage.aspx',
    'MI/Lansing.aspx',
    'MI/Marquette.aspx',
    'MI/Midland.aspx',
    'MI/Monroe.aspx',
    'MI/Mount-Pleasant.aspx',
    'MI/Muskegon-Norton-Shores.aspx',
    'MI/Niles-Benton-Harbor.aspx',
    'MI/Owosso.aspx',
    'MI/Port-Huron.aspx',
    'MI/Saginaw.aspx',
    'MI/Sault-Ste.-Marie.aspx',
    'MI/Sturgis.aspx',
    'MI/Traverse-City.aspx'
];

const LISTINGS_DIR = path.resolve('static', 'listings');
const LISTINGS_JSON_DIR = path.resolve(LISTINGS_DIR, 'json');
const LISTINGS_IMG_DIR = path.resolve(LISTINGS_DIR, 'img');



function getText($el) {
    return $el.text().trim();
}


function extractMetadata(id, body, callback) {
    var $ = cheerio.load(body);

    // Address
    var $loc = $('[itemprop=location]');
    var address = {
        address: getText($loc.find('[itemprop=streetAddress]')),
        city: getText($loc.find('[itemprop=addressLocality]')).replace(/,$/g, ''),
        state: getText($loc.find('[itemprop=addressRegion]')),
        zip: getText($loc.find('[itemprop=postalCode]'))
    };

    // Dates
    $('#SaleDatesWrapper .iconRow_Content br').replaceWith('\n');
    var dirtyDates = getText($('#SaleDatesWrapper .iconRow_Content')).split('\n');
    var dates = {};
    var chunks;
    dirtyDates.forEach(function(v) {
        chunks = v.split(' ');
        dates[chunks[0]] = {starts: chunks[1], ends: chunks[3]};
    });

    // Description
    var $descr = $('[itemtype$="Event"] [itemprop=description] .ckEditorReset');
    var description = null;
    if ($descr.length) {
        description = sanitizeHtml(($descr.html() || '').trim());
    }

    // Images
    var $images = $('[rel=salePics]');
    var images = {
        sold: $images.filter('[data-fancyboxsold]').map(function() {
            return $(this).attr('href').replace(IMG_ORIGIN, '');
        }),
        unsold: $images.filter(':not([data-fancyboxsold])').map(function() {
            return $(this).attr('href').replace(IMG_ORIGIN, '');
        })
    };

    // Organisation
    var $org = $('[itemtype$="Organization"]');
    var organisation = {
        name: getText($org.find('[itemprop=name]')),
        telephone: getText($org.find('[itemprop=telephone]')),
        url: getText($org.find('[itemprop=url]'))
    };

    var data = {
        address: address,
        dates: dates,
        description: description,
        id: id,
        images: images,
        name: getText($('#SaleName')),
        organisation: organisation
    };

    return callback(null, data);
}


function mapCity(v, callback) {
    // Remove everything in the URI after the `MI/` (i.e., the state).
    var slug = v.split('/')[1];
    // Remove the extension in the URI (i.e., `.aspx`).
    slug = slug.split('.')[0];
    // Slugify the city name.
    slug = utils.slugify(slug).toLowerCase();

    var links = [];
    var link = '';

    request.get(BASE_URL + v, function getCityResponse(err, response, body) {
        console.log('Processing city:', slug);

        if (err || response.statusCode !== 200) {
            console.error('Could not fetch ' + BASE_URL + v + '\n', err);
            return callback(err);
        }

        var $ = cheerio.load(body);
        $('#MainSaleListWrapper .saleItem .saleLink').map(function() {
            link = utils.getAbsoluteURI($(this).attr('href'), BASE_ORIGIN);
            if (links.indexOf(link) === -1) {
                links.push(link);
            }
        });

        callback(null, links);
    });
}


function mapListing(v, callback) {
    var listingID;

    request.get(v, function getResponse(err, response, body) {
        // Get the number in the URI after the last slash.
        listingID = parseInt(v.substr(v.lastIndexOf('/') + 1), 10);

        console.log('Processing listing', listingID + ':', v);

        if (err || response.statusCode !== 200) {
            console.error('Could not fetch ' + v + '\n', err);
            return callback(err);
        }

        extractMetadata(listingID, body, function metadata(err, data) {
            if (err) {
                console.error('Could not extract metadata for',
                    listingID + '\n', err);
            }
            callback(err, data);
        });
    });
}


function saveImages(state, listings) {
    var baseDirJSON = path.resolve(LISTINGS_JSON_DIR, state);
    var baseDirIMG = path.resolve(LISTINGS_IMG_DIR, state);
    var imageFN;
    var imageURI;

    // Iterate over each listing.
    listings.forEach(function(listing) {

        // Iterate over each image filename in the listing.
        listing.images.unsold.concat(listing.images.sold).forEach(function(fn) {

            // Strip leading slash from filename.
            imageFN = path.resolve(LISTINGS_IMG_DIR, state, fn.substr(1));

            // URI to original image.
            imageURI = IMG_ORIGIN + fn;

            if (fs.existsSync(imageFN)) {
                console.log('Skipping image (already saved):', fn);
                return;
            }

            // Create directories, as needed.
            utils.mkdirRecursive(path.dirname(imageFN));

            var imgStream = fs.createWriteStream(imageFN);
            imgStream.on('close', function() {
                console.log('Saving image:', imageFN);
            });

            request.get(imageURI, function(err) {
                // Fetch the image.
                console.log('Processing image:', imageURI);

                if (err) {
                    console.error('Could not process image', imageURI + '\n', err);
                }
            }).pipe(
                // Write image to disk.
                imgStream
            );

        });
    });
}


function refreshView(req, res) {
    // Find all listings in a given state.
    var DATA = req.params;
    console.log('\n' + new Date(), '[' + req.method + ']', req.url);

    var state = DATA.state.toLowerCase();
    var cities = CITIES[state];

    console.log('Processing state:', state);

    if (!cities) {
        res.json(400, {error: 'Invalid state.'});
    }

    var stateJSON = path.resolve(LISTINGS_JSON_DIR, state + '.json');

    async.map(CITIES[state], mapCity, function mapCityDone(err, result) {
        if (err) {
            return console.error('Error fetching cities in state:', err);
        }

        console.log('Done processing all cities in state:', result.length);

        // Merge arrays and create a unique array of all the URIs of all
        // the listings.
        var links = [];
        result.forEach(function(list) {
            list.forEach(function(link) {
                // Add to array if (1) it's not already in the array and
                // (2) it contains `/{state}/`.
                if (links.indexOf(link) === -1 &&
                    '/' + state.toUpperCase() + '/'.indexOf(link) !== -1) {
                    links.push(link);
                }
            });
        });

        async.map(links, mapListing, function linksDone(err, result) {
            if (err) {
                return console.error(
                    'Error generating JSON of listings in state:', err);
            }

            fs.writeFile(stateJSON, JSON.stringify(result), function(err) {
                if (err) {
                    return console.error(
                        'Error saving JSON of listings in state:', err);
                }

                console.log('Done saving JSON of listings in state:',
                    result.length);
            });

            // Save images to disk.
            saveImages(state, result);
        });

    });

    res.json(202, {success: true});
}


var refreshEndpoint = {
    url: '/refresh/:state',
    validation: {
        state: {
            description: 'State abbreviation (e.g., mi)',
            isRequired: true
        }
    }
};


server.get(refreshEndpoint, refreshView);


server.listen(process.env.PORT || 5000, function() {
    utils.mkdirRecursive(LISTINGS_JSON_DIR);
    console.log('%s listening at %s', server.name, server.url);
});
