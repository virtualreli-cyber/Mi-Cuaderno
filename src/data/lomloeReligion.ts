import type {
  LomloeCurriculum,
  LomloeKeyCompetenceDef,
  LomloeSpecificCompetence,
} from '../types/gradebook';

/**
 * Competencias Clave oficiales LOMLOE (Real Decreto 217/2022 y 243/2022).
 * Numeradas del 1 al 8 siguiendo la convención estándar en cuadernos docentes (iDoceo).
 */
export const DEFAULT_LOMLOE_KEY_COMPETENCES: LomloeKeyCompetenceDef[] = [
  {
    id: 'CCL',
    code: 'CCL',
    number: 1,
    name: 'Competencia en comunicación lingüística',
    shortName: 'Comunicación lingüística',
    color: '#ef4444',
    iconName: 'MessageSquareText',
  },
  {
    id: 'CP',
    code: 'CP',
    number: 2,
    name: 'Competencia plurilingüe',
    shortName: 'Plurilingüe',
    color: '#f97316',
    iconName: 'Languages',
  },
  {
    id: 'STEM',
    code: 'STEM',
    number: 3,
    name: 'Competencia matemática y en ciencia, tecnología e ingeniería',
    shortName: 'STEM',
    color: '#22c55e',
    iconName: 'Atom',
  },
  {
    id: 'CD',
    code: 'CD',
    number: 4,
    name: 'Competencia digital',
    shortName: 'Digital',
    color: '#eab308',
    iconName: 'Monitor',
  },
  {
    id: 'CPSAA',
    code: 'CPSAA',
    number: 5,
    name: 'Competencia personal, social y de aprender a aprender',
    shortName: 'Personal y social',
    color: '#14b8a6',
    iconName: 'HeartHandshake',
  },
  {
    id: 'CC',
    code: 'CC',
    number: 6,
    name: 'Competencia ciudadana',
    shortName: 'Ciudadana',
    color: '#3b82f6',
    iconName: 'Globe',
  },
  {
    id: 'CE',
    code: 'CE',
    number: 7,
    name: 'Competencia emprendedora',
    shortName: 'Emprendedora',
    color: '#8b5cf6',
    iconName: 'Lightbulb',
  },
  {
    id: 'CCEC',
    code: 'CCEC',
    number: 8,
    name: 'Competencia en conciencia y expresión culturales',
    shortName: 'Conciencia cultural',
    color: '#ec4899',
    iconName: 'Palette',
  },
];

const ESO_SPECIFIC_COMPETENCES: LomloeSpecificCompetence[] = [
  {
    id: 'ce-1',
    number: 1,
    code: 'CE 1',
    title: 'Identidad personal, dignidad humana y proyecto de vida',
    description:
      'Identificar, valorar y expresar los elementos clave de la dignidad e identidad personal a través de la interpretación de biografías significativas, para asumir la propia dignidad y aceptar la identidad personal, respetar la de los otros, y desarrollar con libertad un proyecto de vida con sentido.',
    keyCompetenceIds: ['CCL', 'CD', 'CPSAA', 'CE', 'CCEC'],
  },
  {
    id: 'ce-2',
    number: 2,
    code: 'CE 2',
    title: 'Relación con los otros, convivencia y fraternidad universal',
    description:
      'Valorar la condición relacional del ser humano, desarrollando destrezas y actitudes sociales orientadas a la justicia y a la mejora de la convivencia teniendo en cuenta el magisterio social de la Iglesia, para aprender a vivir con otros y contribuir a la fraternidad universal y la sostenibilidad del planeta.',
    keyCompetenceIds: ['CCL', 'CP', 'STEM', 'CD', 'CPSAA', 'CC', 'CE'],
  },
  {
    id: 'ce-3',
    number: 3,
    code: 'CE 3',
    title: 'Desafíos sociales, inclusión y Reino de Dios',
    description:
      'Asumir los desafíos de la humanidad desde una perspectiva inclusiva reconociendo las necesidades individuales y sociales, discerniéndolos con las claves del «Reino de Dios», para implicarse personal y profesionalmente en la transformación social y el logro del bien común.',
    keyCompetenceIds: ['CCL', 'STEM', 'CD', 'CPSAA', 'CC', 'CE', 'CCEC'],
  },
  {
    id: 'ce-4',
    number: 4,
    code: 'CE 4',
    title: 'Patrimonio cultural, cristianismo y diálogo intercultural',
    description:
      'Interpretar y admirar el patrimonio cultural en sus diferentes expresiones, reconociendo que son portadoras de identidades y sentido, apreciando cómo el cristianismo se ha encarnado en manifestaciones diversas, para desarrollar sentido de pertenencia, participar en la construcción de la convivencia y promover el diálogo intercultural en el marco de los derechos humanos.',
    keyCompetenceIds: ['CCL', 'CP', 'CD', 'CC', 'CCEC'],
  },
  {
    id: 'ce-5',
    number: 5,
    code: 'CE 5',
    title: 'Interioridad, sentido de la vida y experiencia espiritual',
    description:
      'Reconocer y apreciar la propia interioridad, la experiencia espiritual y religiosa, presente en todas las culturas y sociedades, comprendiendo la experiencia de personajes relevantes y valorando las posibilidades de lo religioso, para discernir posibles respuestas a las preguntas sobre el sentido de la vida, y favorecer el respeto entre las diferentes tradiciones religiosas.',
    keyCompetenceIds: ['CCL', 'CPSAA', 'CC', 'CE', 'CCEC'],
  },
  {
    id: 'ce-6',
    number: 6,
    code: 'CE 6',
    title: 'Síntesis de la Teología cristiana y diálogo fe-razón',
    description:
      'Identificar y comprender los contenidos esenciales de la Teología cristiana, contemplando y valorando la contribución de la tradición cristiana a la búsqueda de la verdad, para disponer de una síntesis del cristianismo que permita dialogar con otras tradiciones, paradigmas y cosmovisiones.',
    keyCompetenceIds: ['CCL', 'STEM', 'CD', 'CPSAA', 'CC', 'CE', 'CCEC'],
  },
];

const BAC_SPECIFIC_COMPETENCES: LomloeSpecificCompetence[] = [
  {
    id: 'ce-1',
    number: 1,
    code: 'CE 1',
    title: 'Proyecto vital personal, antropología cristiana y vocación',
    description:
      'Comprender y asumir el proyecto vital personal, reconociendo las propias ideas y creencias, contrastándolas con la antropología cristiana y otras cosmovisiones, para insertarse en la vida adulta y en el mundo profesional.',
    keyCompetenceIds: ['CCL', 'CD', 'CPSAA', 'CE', 'CCEC'],
  },
  {
    id: 'ce-2',
    number: 2,
    code: 'CE 2',
    title: 'Carácter relacional, deberes, libertades y sociedad inclusiva',
    description:
      'Reconocer y desplegar el carácter relacional del ser humano, como fundamento de los deberes y libertades, desarrollando actitudes cívicas y democráticas, contrastando el Evangelio con otros humanismos e ideologías contemporáneas, para aprender a vivir con otros y contribuir a la construcción de una sociedad inclusiva.',
    keyCompetenceIds: ['CCL', 'CP', 'STEM', 'CD', 'CPSAA', 'CC', 'CE'],
  },
  {
    id: 'ce-3',
    number: 3,
    code: 'CE 3',
    title: 'Desafíos democráticos, socioeconómicos y ecología integral',
    description:
      'Interpretar los desafíos democráticos, socioeconómicos y ecológicos, analizando sus causas y consecuencias desde la moral social de la Iglesia, discerniendo las propuestas sociopolíticas de las religiones y los movimientos sociales, para asumir la ecología integral y la responsabilidad personal y social en el cuidado de la vida y del planeta.',
    keyCompetenceIds: ['CCL', 'STEM', 'CD', 'CPSAA', 'CC', 'CE', 'CCEC'],
  },
  {
    id: 'ce-4',
    number: 4,
    code: 'CE 4',
    title: 'Patrimonio cultural, cristianismo y creación cultural',
    description:
      'Comprender y admirar el patrimonio cultural, interpretando su significado y expresiones con los métodos de análisis propios de cada disciplina, valorando críticamente las aportaciones del cristianismo en el desarrollo de los pueblos, para intervenir con criterio propio en el diálogo intercultural, la creación artística y en la construcción social del pensamiento.',
    keyCompetenceIds: ['CCL', 'CP', 'CD', 'CC', 'CCEC'],
  },
  {
    id: 'ce-5',
    number: 5,
    code: 'CE 5',
    title: 'Dimensión espiritual, sentido y diálogo filosófico',
    description:
      'Valorar la dimensión espiritual como fuente de sentido y aprendizajes vitales, a través del análisis de las experiencias personales, del conocimiento de las tradiciones espirituales, y del diálogo interdisciplinar con otras visiones de la vida y del mundo, para descubrir las oportunidades personales, sociales y culturales de la experiencia espiritual como propuesta de plenitud de la vida personal y comunitaria.',
    keyCompetenceIds: ['CCL', 'CPSAA', 'CC', 'CE', 'CCEC'],
  },
  {
    id: 'ce-6',
    number: 6,
    code: 'CE 6',
    title: 'Método teológico, diálogo transdisciplinar y transformación social',
    description:
      'Conocer el método propio de la Teología y sus distintas especialidades analizando su lugar entre los saberes y disciplinas, estableciendo un diálogo transdisciplinar con las otras ciencias, para afrontar críticamente los desafíos éticos y la transformación social.',
    keyCompetenceIds: ['CCL', 'STEM', 'CD', 'CPSAA', 'CC', 'CE', 'CCEC'],
  },
];

const LEGAL_REF = 'BOE-A-2022-10452 (Resolución de 21 de junio de 2022)';

/**
 * Currículos oficiales LOMLOE de Religión Católica desde 1º ESO hasta 1º Bachillerato.
 */
export const DEFAULT_LOMLOE_RELIGION_CURRICULA: LomloeCurriculum[] = [
  {
    id: 'lomloe-rel-eso-1-2',
    name: 'Religión 1º y 2º ESO',
    subject: 'Religión Católica',
    stage: 'ESO_1_2',
    legalReference: LEGAL_REF,
    specificCompetences: ESO_SPECIFIC_COMPETENCES,
    criteria: [
      {
        id: '1.1',
        code: '1.1',
        specificCompetenceId: 'ce-1',
        description:
          'Describir y aceptar los rasgos y dimensiones fundamentales de la identidad personal, analizando relatos bíblicos de vocación y misión, así como otras biografías significativas.',
      },
      {
        id: '1.2',
        code: '1.2',
        specificCompetenceId: 'ce-1',
        description:
          'Identificar las características de la visión bíblica sobre el ser humano, relacionándola con la dignidad personal, reconociéndola en los otros.',
      },
      {
        id: '2.1',
        code: '2.1',
        specificCompetenceId: 'ce-2',
        description:
          'Adquirir habilidades y actitudes de relación con otros, poniendo en práctica estrategias efectivas de reflexión y de comunicación, de ayuda mutua, de participación y de inclusión, orientadas a la mejora de la convivencia en la familia y en la escuela como expresión de la fraternidad universal.',
      },
      {
        id: '2.2',
        code: '2.2',
        specificCompetenceId: 'ce-2',
        description:
          'Desarrollar empatía y reconocimiento de la diversidad personal y social, inspirándose en el ser relacional de Dios, manifestado en la historia de la salvación.',
      },
      {
        id: '3.1',
        code: '3.1',
        specificCompetenceId: 'ce-3',
        description:
          'Generar actitudes de justicia y solidaridad, respetando la diversidad y tomando conciencia de la responsabilidad compartida y la común pertenencia, en el horizonte del Reino de Dios.',
      },
      {
        id: '3.2',
        code: '3.2',
        specificCompetenceId: 'ce-3',
        description:
          'Analizar las necesidades sociales, identificando las situaciones de injusticia, violencia y discriminación, con sus causas, discerniéndolas según el proyecto del Reino de Dios, implicándose en propuestas de transformación social.',
      },
      {
        id: '4.1',
        code: '4.1',
        specificCompetenceId: 'ce-4',
        description:
          'Situar e interpretar las expresiones culturales y sus lenguajes en sus contextos históricos, apreciando su contribución a la identidad personal y social y a los Derechos Humanos, facilitando la convivencia y el diálogo intercultural.',
      },
      {
        id: '4.2',
        code: '4.2',
        specificCompetenceId: 'ce-4',
        description:
          'Razonar cómo la fe cristiana, en el presente y a lo largo de la historia, se ha hecho cultura, interpretando el patrimonio literario, artístico y cultural y valorándolo como expresión de la encarnación del mensaje cristiano en diferentes lenguajes.',
      },
      {
        id: '5.1',
        code: '5.1',
        specificCompetenceId: 'ce-5',
        description:
          'Valorar la experiencia espiritual y religiosa como dimensión humana y social propia de todos los pueblos y culturas, conociendo la especificidad de la espiritualidad judeocristiana y de otras religiones.',
      },
      {
        id: '5.2',
        code: '5.2',
        specificCompetenceId: 'ce-5',
        description:
          'Respetar las diferentes iglesias y tradiciones religiosas, conociendo y valorando las creencias, ritos, símbolos y principios de cada una de ellas, teniendo elementos de juicio personal que favorezcan el diálogo interreligioso.',
      },
      {
        id: '6.1',
        code: '6.1',
        specificCompetenceId: 'ce-6',
        description:
          'Identificar a Jesucristo como núcleo esencial del cristianismo, y la Biblia como libro del Pueblo de Dios, valorando sus aportaciones a la vida de las personas y las sociedades.',
      },
      {
        id: '6.2',
        code: '6.2',
        specificCompetenceId: 'ce-6',
        description:
          'Elaborar una primera síntesis de la fe cristiana, subrayando su capacidad para el diálogo entre la fe y la razón, entre la fe y la cultura, manteniendo las convicciones propias con pleno respeto a las de los otros.',
      },
    ],
  },
  {
    id: 'lomloe-rel-eso-3-4',
    name: 'Religión 3º y 4º ESO',
    subject: 'Religión Católica',
    stage: 'ESO_3_4',
    legalReference: LEGAL_REF,
    specificCompetences: ESO_SPECIFIC_COMPETENCES,
    criteria: [
      {
        id: '1.1',
        code: '1.1',
        specificCompetenceId: 'ce-1',
        description:
          'Reconocer los rasgos esenciales de la antropología cristiana, relacionándolos con los derechos fundamentales y la defensa de la dignidad humana, verificándolos en situaciones globales.',
      },
      {
        id: '1.2',
        code: '1.2',
        specificCompetenceId: 'ce-1',
        description:
          'Formular un proyecto personal de vida con sentido que responda a valores de cuidado propio, de los demás y de la naturaleza, respetando los de los otros, tomando como referencia a Jesucristo, siendo capaz de modular estas opciones en situaciones vitales complejas.',
      },
      {
        id: '2.1',
        code: '2.1',
        specificCompetenceId: 'ce-2',
        description:
          'Asumir valores y actitudes de cuidado personal, de los otros, de la naturaleza y de los espacios comunes, favoreciendo actitudes de respeto, gratuidad, reconciliación, inclusión social y sostenibilidad.',
      },
      {
        id: '2.2',
        code: '2.2',
        specificCompetenceId: 'ce-2',
        description:
          'Cooperar a la construcción de sociedades justas y democráticas, fortaleciendo vínculos sociales e intergeneracionales, y las relaciones en modelos de interdependencia, analizando la realidad, teniendo en cuenta los principios y valores del magisterio social de la Iglesia y promoviendo el desarrollo humano integral.',
      },
      {
        id: '3.1',
        code: '3.1',
        specificCompetenceId: 'ce-3',
        description:
          'Cooperar activamente en proyectos de cuidado y responsabilidad hacia el bien común, inspirados en la perspectiva cristiana, participando en acciones de mejora del entorno y en el planteamiento de las opciones profesionales.',
      },
      {
        id: '3.2',
        code: '3.2',
        specificCompetenceId: 'ce-3',
        description:
          'Contribuir a la fraternidad universal, contrastando críticamente el paradigma científico tecnológico vigente y las narrativas de progreso, con la antropología, la moral y la escatología cristiana, respondiendo con sensibilidad e implicación a situaciones de empobrecimiento y vulnerabilidad.',
      },
      {
        id: '4.1',
        code: '4.1',
        specificCompetenceId: 'ce-4',
        description:
          'Participar críticamente en la promoción de la diversidad cultural, expresando y aportando creativamente las experiencias propias, respetando las diferencias entre personas y comunidades.',
      },
      {
        id: '4.2',
        code: '4.2',
        specificCompetenceId: 'ce-4',
        description:
          'Desarrollar sentido de pertenencia a una tradición cultural, con expresiones sociales, artísticas, éticas y estéticas, valorando adecuadamente su contribución en su momento histórico, relacionándolas con contextos actuales y promoviendo su memoria como legado vivo.',
      },
      {
        id: '5.1',
        code: '5.1',
        specificCompetenceId: 'ce-5',
        description:
          'Formular posibles respuestas a las preguntas de sentido, conociendo y valorando las aportaciones de las tradiciones religiosas, en especial la propuesta de sentido de la vida de Jesucristo, elaborando sus propias respuestas partiendo de un análisis crítico y la adaptación a su situación personal.',
      },
      {
        id: '5.2',
        code: '5.2',
        specificCompetenceId: 'ce-5',
        description:
          'Favorecer la convivencia social en contextos plurales, respetando las opciones personales y generando espacios de diálogo y encuentro.',
      },
      {
        id: '6.1',
        code: '6.1',
        specificCompetenceId: 'ce-6',
        description:
          'Reconocer la Iglesia, comunidad de los discípulos de Jesucristo, y su compromiso en la amistad social como núcleos esenciales del cristianismo, valorando críticamente su contribución cultural e histórica.',
      },
      {
        id: '6.2',
        code: '6.2',
        specificCompetenceId: 'ce-6',
        description:
          'Poner en diálogo el saber religioso con otras disciplinas, tradiciones culturales, paradigmas científicos y tecnológicos y otras cosmovisiones, teniendo en cuenta los métodos propios de cada disciplina y respetando la pluralidad.',
      },
    ],
  },
  {
    id: 'lomloe-rel-bac-1',
    name: 'Religión 1º Bachillerato',
    subject: 'Religión Católica',
    stage: 'BAC_1',
    legalReference: LEGAL_REF,
    specificCompetences: BAC_SPECIFIC_COMPETENCES,
    criteria: [
      {
        id: '1.1',
        code: '1.1',
        specificCompetenceId: 'ce-1',
        description:
          'Identificar e interpretar las ideas y creencias que conforman la identidad personal, contrastándolas con categorías fundamentales de la antropología cristiana (creación, imagen de Dios, libertad, pecado, finitud, etc.) y de otras cosmovisiones.',
      },
      {
        id: '1.2',
        code: '1.2',
        specificCompetenceId: 'ce-1',
        description:
          'Reconocer los elementos esenciales de un proyecto vital en clave vocacional y profesional desde la autonomía, la libertad y la responsabilidad social, con una actitud sincera de búsqueda de la verdad, teniendo en cuenta la propuesta cristiana y los valores sociales.',
      },
      {
        id: '2.1',
        code: '2.1',
        specificCompetenceId: 'ce-2',
        description:
          'Valorar, en el desarrollo de la identidad personal, la pertenencia a múltiples esferas sociales, promoviendo compromisos de respeto a la diversidad e inclusión en sociedades democráticas.',
      },
      {
        id: '2.2',
        code: '2.2',
        specificCompetenceId: 'ce-2',
        description:
          'Distinguir los principios fundamentales del mensaje social cristiano, contrastándolos con otros humanismos e ideologías contemporáneas, aplicándolos a diferentes situaciones sociales.',
      },
      {
        id: '3.1',
        code: '3.1',
        specificCompetenceId: 'ce-3',
        description:
          'Describir los retos políticos y económicos en entornos locales y globales, analizando sus causas y proponiendo posibles soluciones a la luz de la propuesta moral del Reino de Dios y de otras cosmovisiones.',
      },
      {
        id: '3.2',
        code: '3.2',
        specificCompetenceId: 'ce-3',
        description:
          'Diseñar proyectos personales y comunitarios que promuevan la plenitud humana y la transformación social, cultivando la responsabilidad individual, la justicia social y la ecología integral.',
      },
      {
        id: '4.1',
        code: '4.1',
        specificCompetenceId: 'ce-4',
        description:
          'Valorar y admirar las diversas expresiones históricas del patrimonio común de la humanidad, analizando cómo el cristianismo se ha integrado en la historia, con luces y sombras, impregnando la cultura.',
      },
      {
        id: '4.2',
        code: '4.2',
        specificCompetenceId: 'ce-4',
        description:
          'Participar activamente en la creación cultural con sentido crítico, desarrollando sentimientos de pertenencia a la propia tradición y construyendo la diversidad cultural desde criterios humanizadores propios del Evangelio.',
      },
      {
        id: '5.1',
        code: '5.1',
        specificCompetenceId: 'ce-5',
        description:
          'Identificar la dimensión espiritual de la persona y la diversidad del hecho religioso, valorándolas como una realidad presente en las culturas que se expresan de diferentes formas en las sociedades plurales.',
      },
      {
        id: '5.2',
        code: '5.2',
        specificCompetenceId: 'ce-5',
        description:
          'Valorar la experiencia cristiana manifestada en Jesucristo y en tantos testigos a lo largo de la historia, como respuesta plena a las cuestiones vitales y de sentido, en diálogo interdisciplinar con propuestas filosóficas diversas.',
      },
      {
        id: '6.1',
        code: '6.1',
        specificCompetenceId: 'ce-6',
        description:
          'Reconocer las características propias del saber teológico, en cuanto a su método, fuentes y contenido, identificando las semejanzas y diferencias con otros saberes, en especial con la ciencia, y valorando sus aportaciones éticas.',
      },
      {
        id: '6.2',
        code: '6.2',
        specificCompetenceId: 'ce-6',
        description:
          'Discernir los desafíos de la civilización actual, estableciendo las contribuciones que tanto la ciencia como la teología pueden realizar para la transformación social, desde una mutua colaboración.',
      },
    ],
  },
];
