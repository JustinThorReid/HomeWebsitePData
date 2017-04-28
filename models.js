var Promise = require('bluebird');
var fs = require('fs');
var _ = require('lodash');
var path = require('path');
var findOrCreate = require('mongoose-findorcreate')

function isInt(value) {
    var x;
    if (isNaN(value)) {
	return false;
    }
    x = parseFloat(value);
    return (x | 0) === x;
}

function deepMap (obj, cb) {
    var out = {};

    Object.keys(obj).forEach(function (k) {
	var val;

	if (obj[k] !== null && typeof obj[k] === 'object') {
	    val = deepMap(obj[k], cb);
	} else {
	    val = cb(obj[k], k);
	}

	out[k] = val;
    });

    return out;
}

// Create a schema and model for our "table metadata" table
var getDescModel = function (mongoose) {
    var schema = new mongoose.Schema({
	name: String,
	version: Number
    }, {
	retainKeyOrder: true
    });

    schema.plugin(findOrCreate);
    return mongoose.model('_SchemaData', schema);
};

// Create a Mongoose 'Schema' based on a db model description
// Adds in default update and create timestamps which Mongoose does not normally have
function createSchema(columns, extraOptions, mongoose) {
    extraOptions = extraOptions || {};

    if(extraOptions.createdAt !== false && !columns.createdAt) {
	columns.createdAt = {type: Date, required: true, default: Date.now};
    }
    if(extraOptions.updatedAt !== false && columns.updatedAt) {
	columns.updatedAt = {type: Date, required: true, default: Date.now};
    }

    var schema = new mongoose.Schema(columns, {
	retainKeyOrder: true
    });
    schema.plugin(findOrCreate);

    schema.pre('save', function (next) {
	var timestamp = new Date();

	if(this.isNew && !this.createdAt && extraOptions.createdAt !== false) this.createdAt = timestamp;
	if(extraOptions.updatedAt !== false) this.updatedAt = timestamp;
	next();
    });

    schema.set('toJSON', { getters: true, virtuals: false });

    return schema;
}

// Factory method for generating Mongoose "Models" based on the descriptions found in files.
// Function returned can create a full mongoose model given only a description json object
var modelFactory = function (mongoose, DescModel) {
    return function (builder) {
	return new Promise(function(resolve, reject) {
	    DescModel.findOrCreate({'name': builder.name}, function(err, desc) {
		if(err) {
		    console.log(err);
		    reject();
		    return;
		}
		
		desc.version = builder.version;
		desc.save();

		// The Mongoose table name is builder.name
		var model = mongoose.model(builder.name, createSchema(builder.columns, builder.extraOptions, mongoose));
		model.columns = deepMap(builder.columns, function(value, key) {
		    if(key === "type") {
			switch(value) {
			case String:
			    return 'String';
			case Number:
			    return 'Number';
			case Date:
			    return 'Date';
			case Schema.Types.Mixed:
			    return 'Mixed';
			case Schema.Types.ObjectId:
			    return 'ObjectId';
			case Boolean:
			    return 'Boolean';
			default:
			    return 'Unknown';
			}
		    }
		    return value;
		});

		model.version = builder.version;
		resolve(model);
	    });
	});
    };
};

// Only public function exported by this module
// It returns a list of Mongoose "Model" objects after
// Reading in all db description files and generating schemas
//
// It will also update existing data if the description files provide
// an update method
module.exports = function(mongoose, db) {
    return new Promise(function (resolve, reject) {
	// First get existing model versions
	var DescModel = getDescModel(mongoose);

	// Mongoose Model Results
	var promises = [];
	var result = {};
	var createModel = modelFactory(mongoose, DescModel);

	// Find all rows in the model versions meta table
	DescModel.find({}, function(err, versions) {
	    if(err) {
		console.log("ERROR: Could not load model versions");
		throw err;
	    }

	    // Create map of models
	    console.log("Loading table files");
	    var modelBuilders = {};
	    fs
	        .readdirSync(path.join(__dirname, 'db_model'))
	        .filter(function(file) {
		    // All description files are <tablename>.table.js
		    return file.indexOf(".table.js", file.length - ".table.js".length) !== -1;
		})
	        .forEach(function(file) {
		    console.log("  " + file);

		    // Including the model file is expected to return a json object
		    // "Table name" is extracted from the file name
		    var model = require(path.join(__dirname, 'db_model', file));
		    var name = file.replace(/\..*$/, "").replace(/[^a-zA-Z0-9_\-]/, "");
		    model.name = name;

		    if(!isInt(model.version)){
			console.log("    Missing version number");
			throw new Error("Invalid model");
		    } else if(!model.columns) {
			console.log("    Missing columns");
			throw new Error("Invalid model");
		    }
		    
		    modelBuilders[name] = model;
		});

	    var allNames = Object.keys(modelBuilders);
	    
	    // Check all existing models
	    console.log("Checking existing models");
	    _.forEach(versions, function(modelVersion) {
		console.log("  " + modelVersion.name);
		var modelBuilder = modelBuilders[modelVersion.name];
		
		if(modelBuilder) {
		    if(modelBuilder.version === modelVersion.version) {

			console.log("    No change.");
			promises.push(createModel(modelBuilder).then(function(model) {
			    result[modelVersion.name] = model;
			}));
			_.remove(allNames, function(n) {return n === modelVersion.name});
		    } else {
			
			console.log("    Version mismatch, existing is " + modelVersion.version + " new is " + modelBuilder.version);
			throw new Error("Unimplemented feature");
			// Should be calling the model.update function with old version number and new version number
		    }
		} else {
		    
		    console.log("    Table file is missing.");
		    throw new Error("Unimplemented feature");
		    // We found a model in the description table that no long has a description file
		    // The data is now "floating"
		}
	    });

	    // Table names still in the list are new
	    console.log("Adding NEW models");
	    _.forEach(allNames, function (name) {
		console.log("  Creating '" + name + "'");
		promises.push(createModel(modelBuilders[name]).then(function(model) {
		    result[name] = model;
		}));
	    });

	    Promise.all(promises).then(function () {
		resolve(result);
	    });
	});
    });
};
