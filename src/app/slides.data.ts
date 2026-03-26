export interface Slide {
  id: string;
  title: string;
  content: string[];
  experiment?: {
    title: string;
    description: string;
    instructions: string[];
  };
  quiz?: {
    question: string;
    options: string[];
    correctOptionIndex: number;
    explanation?: string;
  }[];
  isTitleSlide?: boolean;
  video?: string;
}

export const SLIDES: Slide[] = [
  {
    id: 'title',
    title: 'Spreekbeurt over Jupiter',
    content: [
      'Gemaakt door: Asbjørn Oost',
      'Klas: Groep 7'
    ],
    isTitleSlide: true
  },
  {
    id: 'inhoud',
    title: 'De Inhoud',
    content: [
      '1. Waar is Jupiter van gemaakt?',
      '2. De Grote Rode Vlek (Met proefje!)',
      '3. Hoe ver is Jupiter weg?',
      '4. Hoe oud is Jupiter?',
      '5. Is Jupiter een normale planeet? (Met proefje!)',
      'Extra: Kunnen we er wonen?',
      'Afsluiting: De Grote Jupiter-Quiz!'
    ]
  },
  {
    id: 'h1',
    title: '1. Waar is Jupiter van gemaakt?',
    content: [
      '• Geen steen of zand zoals de aarde',
      '• Jupiter is een reusachtige gasbol!',
      '• 90% waterstof en 10% helium',
      '• De dampkring is wel 1000 km dik',
      '• Je kunt er niet op landen, want er is geen grond'
    ]
  },
  {
    id: 'h2',
    title: '2. Waar komt de rode vlek vandaan?',
    content: [
      '• Geen vulkaan of eiland',
      '• Reusachtige storm (orkaan)',
      '• Raast al honderden jaren',
      '• Groter dan de hele aarde!',
      '• Rode kleur door zonnestraling'
    ],
    video: 'Jupiter_red_dot_storm.mp4',
    experiment: {
      title: 'Maak je eigen Rode Vlek!',
      description: 'Nodig: Glazen pot met water, lepel, rode limonadesiroop.',
      instructions: [
        'Roer hard met de lepel voor een draaikolk.',
        'Druppel in het midden rode kleurstof.',
        'Kijk hoe de vlek blijft draaien!'
      ]
    }
  },
  {
    id: 'h3',
    title: '3. Hoe ver is Jupiter weg?',
    content: [
      '• De afstand verandert de hele tijd!',
      '• Dichtstbij: 588 miljoen km',
      '• Verst weg: 968 miljoen km',
      '• Licht doet er 33 tot 54 minuten over',
      '• Met de auto zou je honderden jaren rijden!'
    ]
  },
  {
    id: 'h4',
    title: '4. Hoe oud is Jupiter?',
    content: [
      '• Ongeveer 4,5 miljard jaar oud!',
      '• De oudste planeet in ons zonnestelsel',
      '• Razendsnel ontstaan: binnen 1 miljoen jaar',
      '• Gemaakt van gas en stof uit de ruimte'
    ]
  },
  {
    id: 'h5',
    title: '5. Is Jupiter een normale planeet?',
    content: [
      '• De allergrootste planeet — een gasreus!',
      '• Meer dan 300× zwaarder dan de aarde',
      '• Draait super snel om zijn as',
      '• Eén dag duurt maar 9 uur en 55 minuten',
      '• Je weegt er 2,5× meer dan op aarde!'
    ],
    video: 'Jupiter_Size_Comparison_Video.mp4',
    experiment: {
      title: 'Hoe zwaar ben je op Jupiter?',
      description: 'Nodig: Tasje met 1 kilo suiker, tasje met 2,5 kilo suiker.',
      instructions: [
        'Voel het tasje van 1 kilo (gewicht op aarde).',
        'Voel het tasje van 2,5 kilo (gewicht op Jupiter).',
        'Verschil: Je bent op Jupiter ruim 2x zo zwaar!'
      ]
    }
  },
  {
    id: 'extra',
    title: 'Extra: Kunnen we op Jupiter wonen?',
    content: [
      '• Nee! Geen grond, enorme druk en keiharde wind',
      '• Maar... Jupiter heeft 95 manen!',
      '• Op de maan Europa zit misschien een oceaan onder het ijs',
      '• Jupiter trekt zo hard aan de maan Io dat die opwarmt',
      '• Misschien is daar ooit leven te vinden?'
    ]
  },
  {
    id: 'quiz',
    title: '🏆 De Grote Jupiter-Afvalrace!',
    content: [
      'Iedereen gaat staan!',
      'Kies A (handen op je hoofd) of B (handen op je rug).',
      'Fout? Dan moet je gaan zitten!',
      'Wie blijft er als laatste over?'
    ],
    quiz: [
      {
        question: '1. Uit welke gassen bestaat Jupiter vooral?',
        options: ['A: Zuurstof en Stikstof', 'B: Waterstof en Helium'],
        correctOptionIndex: 1,
        explanation: 'Net als de zon bestaat Jupiter vooral uit waterstof en helium!'
      },
      {
        question: '2. Wat is de Grote Rode Vlek?',
        options: ['A: Een reusachtige storm', 'B: Een grote vulkaan'],
        correctOptionIndex: 0,
        explanation: 'Het is een storm die al honderden jaren raast en groter is dan de aarde!'
      },
      {
        question: '3. Hoe lang duurt een dag op Jupiter?',
        options: ['A: Bijna 10 uur', 'B: Bijna 24 uur'],
        correctOptionIndex: 0,
        explanation: 'Jupiter draait super snel om zijn as, dus een dag is heel kort.'
      },
      {
        question: '4. Hoeveel manen heeft Jupiter (ongeveer)?',
        options: ['A: 1 (net als de aarde)', 'B: 95'],
        correctOptionIndex: 1,
        explanation: 'Jupiter heeft een enorme zwaartekracht en houdt wel 95 manen in zijn baan!'
      },
      {
        question: '5. Is Jupiter zwaarder of lichter dan de aarde?',
        options: ['A: Meer dan 300× zwaarder', 'B: 10× lichter'],
        correctOptionIndex: 0,
        explanation: 'Jupiter is de zwaarste planeet van ons hele zonnestelsel.'
      }
    ]
  },
  {
    id: 'afsluiting',
    title: 'Einde',
    content: [
      'Dit was mijn spreekbeurt!',
      'Zijn er nog vragen?'
    ],
    isTitleSlide: true
  }
];
