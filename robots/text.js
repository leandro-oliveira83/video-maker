const algorithmiaApiKey = require('../credentials/algorithmia.json').apiKey;
const watsonApiCredentials = require('../credentials/watson-nlu.json');

const algorithmia = require('algorithmia');
const sentenceBoundaryDetection = require('sbd');
const NaturalLanguageUnderstandingV1 = require('ibm-watson/natural-language-understanding/v1');
const { IamAuthenticator } = require('ibm-watson/auth');

const nlu = new NaturalLanguageUnderstandingV1({
  version: '2021-08-01',
  authenticator: new IamAuthenticator({
    apikey: watsonApiCredentials.apikey,
  }),
  serviceUrl: watsonApiCredentials.url,
});

const state = require('./state.js');

async function robot() {
  const content = state.load();

  await fetchContentFromWikipedia(content);
  sanitizeContent(content);
  breakContentIntoSentences(content);
  limitMaximumSentences(content);
  await fetchKeywordsOfAllSentences(content);

  state.save(content);

  async function fetchContentFromWikipedia(content) {
    const algorithmiaAuthenticated = algorithmia(algorithmiaApiKey);
    const wikipediaAlgorithm = algorithmiaAuthenticated.algo('web/WikipediaParser/0.1.2?timeout=300');
    const wikipediaResponse = await wikipediaAlgorithm.pipe(content.searchTerm);
    const wikipediaContent = wikipediaResponse.get();

    content.sourceContentOriginal = wikipediaContent.content;
  }

  function sanitizeContent(content) {
    const withoutBlankLinesAndMarkdown = removeBlankLinesAndMarkdown(content.sourceContentOriginal);
    const withoutDatesInParentheses = removeDatesInParentheses(withoutBlankLinesAndMarkdown);

    content.sourceContentSanitized = withoutDatesInParentheses;

    function removeBlankLinesAndMarkdown(text) {
      const allLines = text.split('\n');

      const withoutBlankLinesAndMarkdown = allLines.filter((line) => {
        if (line.trim().length === 0 || line.trim().startsWith('=')) {
          return false;
        }

        return true;
      });

      return withoutBlankLinesAndMarkdown.join(' ');
    }

    function removeDatesInParentheses(text) {
      return text.replace(/\((?:\([^()]*\)|[^()])*\)/gm, '').replace(/  /g, ' ');
    }
  }

  function breakContentIntoSentences(content) {
    content.sentences = [];

    const sentences = sentenceBoundaryDetection.sentences(content.sourceContentSanitized);
    sentences.forEach((sentences) => {
      content.sentences.push({
        text: sentences,
        keywords: [],
        images: []
      });
    });
  }

  function limitMaximumSentences(content) {
    content.sentences = content.sentences.slice(0, content.maximumSentences)
  }

  async function fetchKeywordsOfAllSentences(content) {
    for (const sentence of content.sentences) {
      sentence.keywords = await fetchWatsonAndReturnKeywords(sentence.text);
    }
  }

  async function fetchWatsonAndReturnKeywords(sentence) {

    const analyzeParams = {
      'text': sentence,
      'features': {
        'keywords': {}
      }
    };

    return nlu.analyze(analyzeParams)
      .then(response => {
        const keywords = response.result.keywords.map((keyword) => {
          return keyword.text;
        });

        return keywords;
      })
      .catch(err => {
        console.log('error:', err);
      });
  }
}

module.exports = robot;