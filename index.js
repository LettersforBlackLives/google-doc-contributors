var Consts = {
  ClientID: '1053866203947-gc9nbfu9tgk5s995p8hikfv83mb66dgo.apps.googleusercontent.com',
  Scopes: [
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ],
};

var GoogleAPILoaded = false;
function onGoogleAPILoad() {
  console.log('Google API loaded');
  GoogleAPILoaded = true;
  if (window.VM) {
    window.VM.init();
  }
};

function VM() {
  // Use a msg to debug user issues
  this.userMsg = ko.observable('Initializing JS...');

  this.authed = ko.observable(false);
  this.needAuth = ko.observable(false);

  this.files = ko.observableArray();

  this.prevPageToken = ko.observable();
  this.currentPageToken = ko.observable();
  this.nextPageToken = ko.observable();

  this.file = ko.observable('');
  this.fileMsg = ko.observable('');

  this.revisors = ko.observableArray();
  this.revisorsCSV = ko.computed(function () {
    var csv = '#email,revision_count\n';
    var revisors = this.revisors();


    for (var i=0; i < revisors.length; i++) {
      var row = (
          '' + revisors[i].email +
          ',' + revisors[i].count +
          (i < revisors.length - 1 ? '\n' : ''));
      csv = csv + row;
    }

    return csv;
  }.bind(this));

  this.init = function () {
    // Check for user having just opened the file
    console.log('protocol:', window.location.protocol);
    if (window.location.protocol == 'file:') {
      this.userMsg('For this app to work, you need to run `python -m SimpleHTTPServer 8000` in terminal, then browse to http://localhost:8000');
      return
    }

    console.log('Checking auth');
    this.userMsg('Checking google drive auth...');
    gapi.auth.authorize(
      {
        'client_id': Consts.ClientID,
        'scope': Consts.Scopes.join(' '),
        'immediate': true
      },
      this.handleAuthResult);
  };

  this.handleAuthResult = function (authResult) {
    console.log(authResult);
    if (authResult && !authResult.error) {
      console.log('Already authed');

      this.authed(true);
      this.needAuth(false);

      this.userMsg('Getting list of files...');
      gapi.client.load('drive', 'v3', this.listFiles);
    } else {
      console.log('Need to get auth');

      this.authed(false);
      this.needAuth(true);
    }
  }.bind(this);

  this.handleAuthClick = function () {
    console.log('Authorizing');
    gapi.auth.authorize(
      {client_id: Consts.ClientID, scope: Consts.Scopes, immediate: false},
      this.handleAuthResult);
    return false;
  }.bind(this);

  this.listFiles = function () {
    console.log('Listing files. pageToken:', this.currentPageToken());

    gapi.client.drive.files.list({
      pageSize: 10,
      fields: 'nextPageToken, files(id, name)',
      pageToken: this.currentPageToken() || '',
    }).execute(function (reply) {
      console.log('Files reply:', reply);
      if (!reply || !reply.files) {
        this.userMsg('No files found');
        return
      }

      this.userMsg('');
      this.files(reply.files);
      this.nextPageToken(reply.nextPageToken);
    }.bind(this));
  }.bind(this);

  this.onFileChoose = function (file) {
    console.log('User chose file:', file);

    this.fileMsg('Checking file...');
    this.revisors.removeAll();
    this.file(file.name);

    gapi.client.drive.revisions.list({
      fileId: file.id,
      fields: 'revisions(id,lastModifyingUser)',
    }).execute(function (reply) {
      console.log('Revisions reply:', reply);
      if (!reply || reply.code || !reply.revisions) {
        this.fileMsg('Failed to get info about file: ' + reply.message);
        return
      }
      this.fileMsg('');

      var revisors = {};

      for (var i=0; i < reply.revisions.length; i++) {
        var rev = reply.revisions[i];
        var email = (
            rev && rev.lastModifyingUser &&
            rev.lastModifyingUser.emailAddress);
        var count = email && revisors[email] || 0;
        if (email) {
          revisors[email] = count + 1;
        }
      }
      console.log('Revisors:', revisors);

      for (var email in revisors) {
        this.revisors.push({email: email, count: revisors[email]});
      }
      this.revisors.sort(function (a, b) {
        return b.count - a.count;
      });
    }.bind(this));
  }.bind(this);

  this.handlePrevFiles = function () {
    this.nextPageToken(this.currentPageToken());
    this.currentPageToken(this.prevPageToken());
    this.prevPageToken(null);

    this.listFiles();
  }.bind(this);

  this.handleNextFiles = function () {
    this.prevPageToken(this.currentPageToken());
    this.currentPageToken(this.nextPageToken());
    this.nextPageToken(null);

    this.listFiles();
  }.bind(this);
};

document.addEventListener("DOMContentLoaded", function(event) { 
  window.VM = new VM();
  ko.applyBindings(window.VM);

  if (window.GoogleAPILoaded) {
    window.VM.init();
  }
});
