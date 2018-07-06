const deepcopy = require("deepcopy");
const _ = require('lodash');

const coordinatesHelper = require('./coordinatesHelper');
const vision = require('@google-cloud/vision');
var client = new vision.v1.ImageAnnotatorClient({
});

var express    = require('express');        // call express
var app        = express();                 // define our app using express
var bodyParser = require('body-parser');

var request = require('request').defaults({ encoding: null });
var fs = require('fs');

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = process.env.PORT || 3000;        // set our port

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router();              // get an instance of the express Router

var multer = require('multer');
var storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, '/tmp')
    },
    filename: (req, file, cb) => {
      cb(null, file.fieldname + '-' + Date.now())
    }
});
var upload = multer({storage: storage});

var download = function(uri, filename, callback){
  request.head(uri, function(err, res, body){    
    request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
  });
};


router.get('/', function(req, res) {
  res.render('index', { title: 'Image Menu to Text Menu Converter' });
});

// Image to text api
router.post('/v1/convert', upload.single('image'), function(req, res) {
    var path = '/tmp/';
    if (!req.file) {
	var url = req.body.url;
	path = '/tmp/image'+Date.now();
	download(url, path, function(){
	client
        .textDetection(path)
        .then(results => {
                const detections = results[0];
                if(detections.textAnnotations.length > 0){
                        res.json({ sucees: true, message: mergeNearByWords(detections)});
                }
                else {
                        res.json({ success:true, message: []});
                }
		fs.unlinkSync(path);
        })
        .catch(err => {
                console.error('ERROR:', err);
                res.json({ success: flase, message: "Error occured!" });
		fs.unlinkSync(path);
        });	
	});
    }
    else {
	path = '/tmp/'+req.file.filename;
	client
    	.textDetection(path)
    	.then(results => {
       		const detections = results[0];
        	if(detections.textAnnotations.length > 0){
                	res.json({ sucees: true, message: mergeNearByWords(detections)});
        	}
        	else {
                	res.json({ success:true, message: []});
        	}
		fs.unlinkSync(path);
    	})
    	.catch(err => {
        	console.error('ERROR:', err);
        	res.json({ success: flase, message: "Error occured!" });
		fs.unlinkSync(path);
    	});	
    }
});

app.use('/', router);
app.set('view engine', 'jade');
app.listen(port);
console.log('Magic happens on port ' + port);

/**
 * GCP Vision groups several nearby words to appropriate lines
 * But will not group words that are too far away
 * This function combines nearby words and create a combined bounding polygon
 */

function mergeNearByWords(data) {

    const yMax = coordinatesHelper.getYMax(data);
    data = coordinatesHelper.invertAxis(data, yMax);

    // Auto identified and merged lines from gcp vision
    let lines = data.textAnnotations[0].description.split('\n');
    // gcp vision full text
    let rawText = deepcopy(data.textAnnotations);

    // reverse to use lifo, because array.shift() will consume 0(n)
    lines = lines.reverse();
    rawText = rawText.reverse();
    // to remove the zeroth element which gives the total summary of the text
    rawText.pop();

    let mergedArray = getMergedLines(lines, rawText);

    coordinatesHelper.getBoundingPolygon(mergedArray);
    coordinatesHelper.combineBoundingPolygon(mergedArray);

    // This does the line segmentation based on the bounding boxes
    let finalArray = constructLineWithBoundingPolygon(mergedArray);
    //console.log(finalArray);
    return finalArray;
}

// TODO implement the line ordering for multiple words
function constructLineWithBoundingPolygon(mergedArray) {
    let finalArray = [];

    for(let i=0; i< mergedArray.length; i++) {
        if(!mergedArray[i]['matched']){
            if(mergedArray[i]['match'].length === 0){
                finalArray.push(mergedArray[i].description)
            }else{
                // arrangeWordsInOrder(mergedArray, i);
                // let index = mergedArray[i]['match'][0]['matchLineNum'];
                // let secondPart = mergedArray[index].description;
                // finalArray.push(mergedArray[i].description + ' ' +secondPart);
                finalArray.push(arrangeWordsInOrder(mergedArray, i));
            }
        }
    }
    return finalArray;
}

function getMergedLines(lines,rawText) {

    let mergedArray = [];
    while(lines.length !== 1) {
        let l = lines.pop();
        let l1 = deepcopy(l);
        let status = true;

        let data = "";
        let mergedElement;

        while (true) {
            let wElement = rawText.pop();
            if(wElement === undefined) {
                break;
            }
            let w = wElement.description;

            let index = l.indexOf(w);
            let temp;
            // check if the word is inside
            l = l.substring(index + w.length);
            if(status) {
                status = false;
                // set starting coordinates
                mergedElement = wElement;
            }
            if(l === ""){
                // set ending coordinates
                mergedElement.description = l1;
                mergedElement.boundingPoly.vertices[1] = wElement.boundingPoly.vertices[1];
                mergedElement.boundingPoly.vertices[2] = wElement.boundingPoly.vertices[2];
                mergedArray.push(mergedElement);
                break;
            }
        }
    }
    return mergedArray;
}

function arrangeWordsInOrder(mergedArray, k) {
    let mergedLine = '';
    let wordArray = [];
    let line = mergedArray[k]['match'];
    // [0]['matchLineNum']
    for(let i=0; i < line.length; i++){
        let index = line[i]['matchLineNum'];
        let matchedWordForLine = mergedArray[index].description;

        let mainX = mergedArray[k].boundingPoly.vertices[0].x;
        let compareX = mergedArray[index].boundingPoly.vertices[0].x;

        if(compareX > mainX) {
            mergedLine = mergedArray[k].description + ' ' + matchedWordForLine;
        }else {
            mergedLine = matchedWordForLine + ' ' + mergedArray[k].description;
        }
    }
    return mergedLine;
}
