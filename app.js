var fs = require('fs');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;

var async = require('async');
var cheerio = require('cheerio');
var request = require('request');

var server = require('./server');
var utils = require('./lib/utils');


const BASE_ORIGIN = 'http://www.estatesales.net';
const BASE_URL = BASE_ORIGIN + '/estate-sales/';

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

var listingsDir = path.resolve('static', 'listings');


function refreshView(req, res) {
    // Find all listings in a given state.
    var DATA = req.params;
    console.log('\n' + new Date(), '[' + req.method + ']', req.url);
    console.log(DATA);

    var state = DATA.state.toLowerCase();

    var stateTXT = path.resolve(listingsDir, state + '.txt');

    if (fs.existsSync(stateTXT)) {
        fs.unlinkSync(stateTXT);
    }

    var tasks = [];
    var links = [];
    var link = '';

    async.map(CITIES[state], function mapCity(v, callback) {
        // Remove everything in the URI after the "MI/" (i.e., the state).
        var slug = v.split('/')[1];

        // Remove the extension in the URI (i.e., '.aspx').
        slug = slug.split('.')[0];

        slug = utils.slugify(slug).toLowerCase();

        var baseDir = path.resolve(listingsDir, state);

        if (!fs.existsSync(baseDir)) {
            console.error('Directory "' + baseDir + '" does not exist');
            utils.mkdirRecursive(baseDir);
        }

        var cityHTML = path.resolve(baseDir, slug + '.html');

        request.get(BASE_URL + v, function getResponse(err, response, body) {
            console.log('Processing city:', slug);
            if (err || response.statusCode !== 200) {
                console.error('Could not fetch ' + BASE_URL + v + '\n', err);
                return callback(err);
            }
            fs.writeFile(cityHTML, body);
            var $ = cheerio.load(body);
            $('#MainSaleListWrapper .saleItem .saleLink').map(function() {
                link = utils.getAbsoluteURI($(this).attr('href'), BASE_ORIGIN);
                if (links.indexOf(link) === -1) {
                    links.push(link);
                }
            });
            callback(null, links);
        });
    }, function mapCityDone(err, result) {
        if (err) {
            return console.error('Error:', err);
        }
        console.log('Done');
        fs.appendFile(stateTXT, links.sort().join('\n'), function(err) {
            if (err) {
                console.error(err);
            }
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
    console.log('%s listening at %s', server.name, server.url);
});
